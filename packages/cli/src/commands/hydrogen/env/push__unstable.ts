import Command from '@shopify/cli-kit/node/base-command';
import {diffLines} from 'diff';
import {commonFlags, flagsToCamelObject} from '../../../lib/flags.js';
import {login} from '../../../lib/auth.js';
import {getCliCommand} from '../../../lib/shell.js';
import {resolvePath} from '@shopify/cli-kit/node/path';
import {
  renderConfirmationPrompt,
  renderSelectPrompt,
  renderInfo,
  renderWarning,
  renderSuccess,
} from '@shopify/cli-kit/node/ui';
import {fileExists, readFile} from '@shopify/cli-kit/node/fs';
import {
  outputContent,
  outputToken,
} from '@shopify/cli-kit/node/output';
import {
  renderMissingLink,
} from '../../../lib/render-errors.js';
import {Environment, getStorefrontEnvironments} from '../../../lib/graphql/admin/list-environments.js';
import {linkStorefront} from '../link.js';
import {getStorefrontEnvVariables} from '../../../lib/graphql/admin/pull-variables.js';
import {HydrogenStorefrontEnvironmentVariableInput, pushStorefrontEnvVariables} from '../../../lib/graphql/admin/push-variables.js';

export default class EnvPush extends Command {
  static description =
    'Push your local variables from .env to your Hydrogen storefront.';

  static flags = {
    environment: commonFlags.environment,
    path: commonFlags.path,
    force: commonFlags.force,
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(EnvPush);
    await runEnvPush({...flagsToCamelObject(flags)});
  }
}

interface Flags {
  environment?: string;
  path?: string;
}

export async function runEnvPush({
  environment,
  path = process.cwd(),
}: Flags) {
  let validatedEnvironment: Partial<Environment> = {};

  // Ensure .env file exists before anything
  const dotEnvPath = resolvePath(path, '.env');
  if (!fileExists(dotEnvPath)) {
    renderWarning({
      headline: 'Local .env file not found',
      body: '.env could not be located in the root directory, or at the specified path.'
    });
    process.exit(1);
  }
  const existingEnv = await readFile(dotEnvPath);

  // Authenticate
  const [{session, config}, cliCommand] = await Promise.all([
    login(path),
    getCliCommand(),
  ]);

  if (!config.storefront?.id) {
    renderMissingLink({session, cliCommand});

    const runLink = await renderConfirmationPrompt({
      message: outputContent`Run ${outputToken.genericShellCommand(
        `${cliCommand} link`,
      )}?`.value,
    });

    if (!runLink) return;

    config.storefront = await linkStorefront(path, session, config, {
      cliCommand,
    });
  }

  if (!config.storefront?.id) return;

  // Fetch environments
  const {environments: environmentsData} = await getStorefrontEnvironments(
    session,
    config.storefront.id,
  ) ?? {};

  if (!environmentsData) {
    renderWarning({
      body: 'Failed to fetch environments',
    });
    process.exit(1);
  };

  // Order environments
  const environments = [
    ...environmentsData.filter((environment) => environment.type === 'PREVIEW'),
    ...environmentsData.filter((environment) => environment.type === 'CUSTOM'),
    ...environmentsData.filter((environment) => environment.type === 'PRODUCTION'),
  ];

  if (environments.length === 0) {
    renderWarning({
      headline: 'No environments found',
    });
    process.exit(1);
  }

  // Select and validate an environment, if not passed via the flag
  if (environment) {
    // If an environment was passed in, ensure the parameter is a valid environment, and unique
    const matchedEnvironments = environments.filter(({name}) => name === environment);
    if (matchedEnvironments.length === 0) {
      renderWarning({
        headline: 'Environment not found',
        body: `We could not find an environment matching the name '${environment}'.`
      });
      process.exit(1);
    } else if (matchedEnvironments.length === 1) {
      const {id, name, branch, type} = matchedEnvironments[0] ?? {};
      validatedEnvironment = {id, name, branch, type};
    } else {
      // Prompt the user for a selection if there are multiple matches
      const selection = await renderSelectPrompt({
        message: `There were multiple environments found with the name ${environment}:`,
        choices:
        [
          ...matchedEnvironments.map(({id, name, branch, type, url}) => ({
            label: `${name} (${branch}) ${type} ${url}`,
            value: id,
          })),
        ]
      });
      const {id, name, branch, type} = matchedEnvironments.find(({id}) => id === selection) ?? {};
      validatedEnvironment = {id, name, branch, type};
    }
  } else {
    // Environment flag not passed
    const choices = [
      ...environments.map(({id, name, branch}) => ({
        label: branch ? `${name} (${branch})` : name,
        value: id,
      })),
    ];

    const pushToBranchSelection = await renderSelectPrompt({
      message: 'Select a set of environment variables to overwrite:',
      choices,
    });

    const {id, name, branch, type} = environments.find(({id}) => id === pushToBranchSelection) ?? {};
    validatedEnvironment = {id, name, branch, type};
  }

  // Fetch remote variables
  const {environmentVariables = []} = await getStorefrontEnvVariables(
    session,
    config.storefront.id,
    validatedEnvironment.branch ?? undefined,
  ) ?? {};

  // Generate a list of remote secrets
    const remoteSecrets = environmentVariables.reduce((acc, {isSecret, key}) =>
    isSecret ? [...acc, key] : acc,
    [] as string[],
  );

  // Normalize remote variables
  const remoteVars = environmentVariables.reduce((acc, {isSecret, key, value}) => {
    if (isSecret) return acc; // ignore secrets for diff
    return `${acc}${key}=${value.replace(/\n/g, "\\n")}\n`;
  }, '');
  const parsedRemoteVars = parseEnvFile(remoteVars);
  const compareableRemoteVars = Object.keys(parsedRemoteVars)
    .map((key: string) => ({ key, value: parsedRemoteVars[key]}))
    .map(({key, value}) => `${key}=${value?.replace(/\n/g, "\n")}`).join('\n');

  // Normalize local variables
  const parsedLocalVars = parseEnvFile(existingEnv);
  const localVariables = Object.keys(parsedLocalVars)
    .reduce((acc, key) => {
      if (remoteSecrets.includes(key)) return acc;
      return [...acc, ({ key, value: parsedLocalVars[key]?.replace(/\n/g, "\\n")})];
    }, [] as HydrogenStorefrontEnvironmentVariableInput[]);
  const compareableLocalVars = localVariables
    .map(({key, value}) => `${key}=${value}`).join('\n');

  // Find secrets that are both remote and local
  const matchingSecrets = remoteSecrets.filter((key) => Object.keys(parsedLocalVars).includes(key));

  // Confirm changes and show a generate diff of changes
  if (!validatedEnvironment.name) process.exit(1);

  if (compareableLocalVars === compareableRemoteVars) {
    renderInfo({
      body: `No changes to your environment variables.${Boolean(matchingSecrets.length) ? `\n\nVariables with secret values cannot be pushed from the CLI: ${matchingSecrets.join(', ')}.` : ''}`,
    });
    process.exit(0);
  } else {
    const diff = diffLines(compareableRemoteVars, compareableLocalVars);
    const confirmPush = await renderConfirmationPrompt({
      confirmationMessage: `Yes, confirm changes`,
      cancellationMessage: `No, make changes later`,
      message: outputContent`We'll make the following changes to your environment variables for ${validatedEnvironment.name}:

${outputToken.linesDiff(diff)}
${Boolean(matchingSecrets.length) ? `Secret keys cannot be pushed: ${matchingSecrets.join(', ')}` : ''}

Continue?`.value,
    });

    // Cancelled making changes
    if (!confirmPush) process.exit(0);
  }

  if (!validatedEnvironment.id) process.exit(1);
  const {userErrors} = await pushStorefrontEnvVariables(
    session,
    config.storefront.id,
    validatedEnvironment.id,
    localVariables,
  );

  if (userErrors.length) {
    renderWarning({
      headline: 'Failed to upload and save environment variables',
      body: userErrors[0]?.message,
    });
  }

  renderSuccess({
    body: `Push to ${validatedEnvironment.branch ?? ''} successful.`
  });

  process.exit(0);
}

// Referenced from dotenv
// https://github.com/motdotla/dotenv/blob/master/lib/main.js#L12
const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg
const parseEnvFile = (src: string) => {
  const obj: Record<string, string> = {};

  // Convert buffer to string
  // Convert line breaks to same format
  const lines = src.toString().replace(/\r\n?/mg, '\n');

  let match;
  while ((match = LINE.exec(lines)) != null) {
    const key = match[1];

    // Default undefined or null to empty string, trim
    let value = (match[2] ?? '').trim();

    // Check if double quoted
    const maybeQuote = value[0];

    // Remove surrounding quotes
    value = value.replace(/^(['"`])([\s\S]*)\1$/mg, '$2');

    // Expand newlines if double quoted
    if (maybeQuote === '"') {
      value = value.replace(/\\n/g, '\n');
      value = value.replace(/\\r/g, '\r');
    }

    // Add to object
    if (key) obj[key] = value;
  }

  return obj
}
