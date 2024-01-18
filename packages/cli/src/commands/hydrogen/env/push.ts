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
  renderError,
} from '@shopify/cli-kit/node/ui';
import {fileExists, readFile, writeFile} from '@shopify/cli-kit/node/fs';
import {
  outputContent,
  outputInfo,
  outputToken,
} from '@shopify/cli-kit/node/output';
import {
  renderMissingLink,
  renderMissingStorefront,
} from '../../../lib/render-errors.js';
import {getStorefrontEnvironments} from '../../../lib/graphql/admin/list-environments.js';
import {linkStorefront} from '../link.js';
import {getStorefrontEnvVariables} from '../../../lib/graphql/admin/pull-variables.js';
import {pluralize} from '@shopify/cli-kit/common/string';

const CANCEL_CHOICE = {
  label: 'Cancel without overwriting any environment variables',
  value: null,
};

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
  force?: boolean;
  path?: string;
}

export async function runEnvPush({
  environment,
  path: root = process.cwd(),
  force,
}: Flags) {
  const dotEnvPath = resolvePath(root, '.env');
  if (!fileExists(dotEnvPath)) {
    renderWarning({
      headline: 'Local .env file not found',
      body: '.env could not be located in the root directory, or at the specified path.'
    });
    process.exit(1);
  }

  // Authenticate
  const [{session, config}, cliCommand] = await Promise.all([
    login(root),
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

    config.storefront = await linkStorefront(root, session, config, {
      cliCommand,
    });
  }

  if (!config.storefront?.id) return;

  // Fetch environments
  const environmentsData = await getStorefrontEnvironments(
    session,
    config.storefront.id,
  );

  if (!environmentsData) return;

  const preview = environmentsData.environments.filter((environment) => environment.type === 'PREVIEW')
  const production = environmentsData.environments.filter((environment) => environment.type === 'PRODUCTION')
  const custom = environmentsData.environments.filter((environment) => environment.type === 'CUSTOM')

  const environments = [
    ...preview,
    ...custom,
    ...production,
  ];

  if (environments.length === 0) process.exit(1);

  let validatedEnvironment = null;

  // Select an environment, if not passed via the flag
  if (!environment) {
    const choices = [
      CANCEL_CHOICE,
      ...environments.map(({id, name, branch}) => ({
        label: branch ? `${name} (${branch})` : name,
        value: `${id}-${name}-${branch}`,
      })),
    ];

    const pushToBranchSelection = await renderSelectPrompt({
      message: 'Select a set of environment variables to overwrite:',
      choices,
    });

    // Selected cancel
    if (!pushToBranchSelection) process.exit(0);

    validatedEnvironment = pushToBranchSelection;
  } else {
    // Ensure the parameter is a valid environment, and unique
    const matchedEnvironments = environments.filter(({name}) => name === environment);
    if (!matchedEnvironments.length) {
      renderWarning({
        headline: 'Environment not found',
        body: `We could not find an environment matching the name '${environment}'.`
      });
      process.exit(1);
    };

    if (matchedEnvironments.length >= 2) {
      const selection = await renderSelectPrompt({
        message: `There were multiple environments found with the name ${environment}:`,
        choices:
        [
          CANCEL_CHOICE,
          ...matchedEnvironments.map(({name, branch, type, url}) => ({
            label: `${name} (${branch}) ${type} ${url}`,
            value: `${name}-${branch}`,
          })),
        ]
      });
      validatedEnvironment = selection;
    } else {
      validatedEnvironment = environment;
    }
  }

  const [_id, env, branch] = validatedEnvironment?.split('-') ?? [];
  if (!env) process.exit(1);

  // Generate a diff of the changes, and confirm changes
  if (!force) {
    const environmentVariablesData = await getStorefrontEnvVariables(
      session,
      config.storefront.id,
      branch,
    );

    const variables = environmentVariablesData?.environmentVariables ?? [];
    const fetchedEnv = variables.reduce((acc, {isSecret, key, value}) => {
      return `${acc}${key}=${isSecret ? `""` : value}\n`;
    }, '');

    const existingEnv = await readFile(dotEnvPath);

    if (existingEnv === fetchedEnv) {
      renderInfo({
        body: `No changes to your environment variables`,
      });
    } else {
      const diff = diffLines(fetchedEnv, existingEnv);

      const overwrite = await renderConfirmationPrompt({
        confirmationMessage: `Yes, confirm changes`,
        cancellationMessage: `No, make changes later`,
        message: outputContent`We'll make the following changes to your environment variables for ${env}:

  ${outputToken.linesDiff(diff)}
  Continue?`.value,
      });

      // Cancelled making changes
      if (!overwrite) process.exit(0);
    }
  }

  outputInfo(outputContent`Pushed to ${env}`)

  process.exit(0);
}

// Todo: TEST SECRETS
