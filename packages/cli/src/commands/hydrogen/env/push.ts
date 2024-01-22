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
  // Ensure .env file exists before anything
  const dotEnvPath = resolvePath(path, '.env');
  if (!fileExists(dotEnvPath)) {
    renderWarning({
      headline: 'Local .env file not found',
      body: '.env could not be located in the root directory, or at the specified path.'
    });
    process.exit(1);
  }

  // Read git branch if we're in CI
  const isCI = ciPlatform().isCI;
  let validated: Partial<Environment> = {};
  let gitCommit: GitCommit;

  try {
    gitCommit = await getLatestGitCommit(path);
    validated.branch = isCI ? (/HEAD -> ([^,]*)/.exec(gitCommit.refs) || [])[1] : undefined;
  } catch (error) {
    outputWarn('Could not retrieve Git history.');
  }

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
  if (!isCI) {
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
        const {name, branch, type} = matchedEnvironments[0] ?? {};
        validated = {name, branch, type};
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
        const {name, branch, type} = matchedEnvironments.find(({id}) => id === selection) ?? {};
        validated = {name, branch, type};
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

      const {name, branch, type} = environments.find(({id}) => id === pushToBranchSelection) ?? {};
      validated = {name, branch, type};
    }
  }

  // Generate a diff of the changes, and confirm changes
  if (!isCI && validated.type === 'PRODUCTION' && validated.name) {
    const {environmentVariables = []} = await getStorefrontEnvVariables(
      session,
      config.storefront.id,
      validated.branch ?? undefined,
    ) ?? {};

    const fetchedEnv = environmentVariables.reduce((acc, {isSecret, key, value}) => {
      const entry = `${key}=${isSecret ? `""` : value}`;
      return `${acc}${entry}\n`;
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
        message: outputContent`We'll make the following changes to your environment variables for ${validated.name}:

  ${outputToken.linesDiff(diff)}
  Continue?`.value,
      });

      // Cancelled making changes
      if (!overwrite) process.exit(0);
    }
  }

  outputInfo(outputContent`Pushed to ${validated.branch ?? ''} branch`)

  process.exit(0);
}

// Todo: TEST SECRETS
