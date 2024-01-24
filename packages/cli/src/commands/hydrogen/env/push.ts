import Command from '@shopify/cli-kit/node/base-command';
import {diffLines} from 'diff';
import {commonFlags, flagsToCamelObject} from '../../../lib/flags.js';
import {login} from '../../../lib/auth.js';
import {getCliCommand} from '../../../lib/shell.js';
import {resolvePath} from '@shopify/cli-kit/node/path';
import {
  ensureIsClean,
  getLatestGitCommit,
  GitDirectoryNotCleanError,
} from '@shopify/cli-kit/node/git';
import {
  renderConfirmationPrompt,
  renderSelectPrompt,
  renderInfo,
  renderWarning,
  renderSuccess,
  renderError,
} from '@shopify/cli-kit/node/ui';
import {fileExists, readFile, writeFile} from '@shopify/cli-kit/node/fs';
import {
  outputContent,
  outputInfo,
  outputToken,
  outputWarn,
} from '@shopify/cli-kit/node/output';
import {
  renderMissingLink,
  renderMissingStorefront,
} from '../../../lib/render-errors.js';
import {Environment, getStorefrontEnvironments} from '../../../lib/graphql/admin/list-environments.js';
import {linkStorefront} from '../link.js';
import {getStorefrontEnvVariables} from '../../../lib/graphql/admin/pull-variables.js';
import {pluralize} from '@shopify/cli-kit/common/string';
import {ciPlatform} from '@shopify/cli-kit/node/context/local';
import {HydrogenStorefrontEnvironmentVariableInput, pushStorefrontEnvVariables} from '../../../lib/graphql/admin/push-variables.js';

interface GitCommit {
  refs: string;
  hash: string;
}

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
  let validated: Partial<Environment> = {};

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
  const environmentsData = await getStorefrontEnvironments(
    session,
    config.storefront.id,
  );

  if (!environmentsData) {
    renderWarning({
      headline: 'Failed to fetch environments',
    });
    process.exit(1);
  };

  const preview = environmentsData.environments.filter((environment) => environment.type === 'PREVIEW')
  const production = environmentsData.environments.filter((environment) => environment.type === 'PRODUCTION')
  const custom = environmentsData.environments.filter((environment) => environment.type === 'CUSTOM')

  const environments = [
    ...preview,
    ...custom,
    ...production,
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
      validated = {id, name, branch, type};
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
      validated = {id, name, branch, type};
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
    validated = {id, name, branch, type};
  }

  // Confirm changes and show a generate diff of changes
  if (!validated.name) process.exit(1);

  const {environmentVariables = []} = await getStorefrontEnvVariables(
    session,
    config.storefront.id,
    validated.branch ?? undefined,
  ) ?? {};

  const fetchedEnv = environmentVariables.reduce((acc, {isSecret, key, value}) => {
    const entry = `${key}=${isSecret ? `EXISTING_SECRET_VALUE` : value}`;
    return `${acc}${entry}\n`;
  }, '');

  if (existingEnv === fetchedEnv) {
    renderInfo({
      body: `No changes to your environment variables`,
    });
  } else {
    const diff = diffLines(fetchedEnv, existingEnv);
    const confirmPush = await renderConfirmationPrompt({
      confirmationMessage: `Yes, confirm changes`,
      cancellationMessage: `No, make changes later`,
      message: outputContent`We'll make the following changes to your environment variables for ${validated.name}:

${outputToken.linesDiff(diff)}
Continue?`.value,
    });

    // Cancelled making changes
    if (!confirmPush) process.exit(0);
  }

  const parsedVars = parseEnvFile(existingEnv)
  const envVariables: HydrogenStorefrontEnvironmentVariableInput[] = Object.keys(parsedVars)
    .map((key: string) => ({ key, value: parsedVars[key]}));

  outputInfo(outputContent`Pushing to ${validated.branch ?? ''} branch...`);

  if (!validated.id) process.exit(1);
  const {userErrors} = await pushStorefrontEnvVariables(
    session,
    config.storefront.id,
    validated.id,
    envVariables,
  );

  if (userErrors.length) {
    renderWarning({
      headline: 'Failed to upload and save environment variables',
      body: userErrors[0]?.message,
    });
  }

  outputInfo(outputContent`Push to ${validated.branch ?? ''} successful.`);

  process.exit(0);
}

// TODO: Consesus on secrets
// TODO: Handle CLI token or permissions without link? Remove CLI handling?

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
