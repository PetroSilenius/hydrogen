import Command from '@shopify/cli-kit/node/base-command';
import {commonFlags, flagsToCamelObject} from '../../../lib/flags.js';
import {login} from '../../../lib/auth.js';
import {getCliCommand} from '../../../lib/shell.js';
import {
  renderConfirmationPrompt,
  renderSelectPrompt,
  renderInfo,
  renderWarning,
  renderSuccess,
} from '@shopify/cli-kit/node/ui';
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
import {pluralize} from '@shopify/cli-kit/common/string';

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

  const storefront = await getStorefrontEnvironments(
    session,
    config.storefront.id,
  );

  if (!storefront) return;

  const preview = storefront.environments.filter((environment) => environment.type === 'PREVIEW')
  const production = storefront.environments.filter((environment) => environment.type === 'PRODUCTION')
  const custom = storefront.environments.filter((environment) => environment.type === 'CUSTOM')

  const environments = [
    ...preview,
    ...custom,
    ...production,
  ];

  const choices = [
    {
      label: 'Cancel without overwriting any environment variables',
      value: null,
    },
    ...environments.map(({name, branch}) => ({
      label: branch ? `${name} (${branch})` : name,
      value: name,
    })),
  ];

  let validatedEnvironment = null;

  if (!environment) {
    const selection = await renderSelectPrompt({
      message: 'Select a set of environment variables to overwrite:',
      choices,
    });

    if (!selection) process.exit(1);

    validatedEnvironment = selection;
  } else {
    const environmentParamFound = environments.find(({name}) => name === environment);
    if (!environmentParamFound) process.exit(1);

    validatedEnvironment = environment;
  }

  outputInfo(outputContent`${validatedEnvironment}`)

  if (!force) {
    const confirmSelection = await renderConfirmationPrompt({
      message: outputContent`Are you sure you want to overwrite the environment variables for ${validatedEnvironment}?`.value,
    });

    if (!confirmSelection) process.exit(1);
  }

  process.exit(0);
}
