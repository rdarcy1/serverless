'use strict';

const path = require('path');
const memoizee = require('memoizee');
const inquirer = require('@serverless/utils/inquirer');
const { log } = require('@serverless/utils/log');
const resolveProviderCredentials = require('@serverless/dashboard-plugin/lib/resolve-provider-credentials');
const isAuthenticated = require('@serverless/dashboard-plugin/lib/is-authenticated');
const hasLocalCredentials = require('../../aws/has-local-credentials');

const fsp = require('fs').promises;

const yamlExtensions = new Set(['.yml', '.yaml']);

const appPattern = /^(?:#\s*)?app\s*:.+/m;
const orgPattern = /^(?:#\s*)?org\s*:.+/m;
const consolePattern = /^(?:#\s*)?console\s*:(.*)/m;
const dashboardPattern = /^(?:#\s*)?dashboard\s*:.+/m;

const ServerlessError = require('../../serverless-error');
const resolveStage = require('../../utils/resolve-stage');
const resolveRegion = require('../../utils/resolve-region');

module.exports = {
  confirm: async (message, options = {}) => {
    const name = options.name || 'isConfirmed';
    return (
      await inquirer.prompt({
        message,
        type: 'confirm',
        name,
      })
    )[name];
  },
  doesServiceInstanceHaveLinkedProvider: async ({ configuration, options }) => {
    const region = resolveRegion({ configuration, options });
    const stage = resolveStage({ configuration, options });
    let result;
    try {
      result = await resolveProviderCredentials({ configuration, region, stage });
    } catch (err) {
      if (err.statusCode && err.statusCode >= 500) {
        throw new ServerlessError(
          'Serverless Dashboard is currently unavailable, please try again later',
          'DASHBOARD_UNAVAILABLE'
        );
      }
      throw err;
    }

    return Boolean(result);
  },
  resolveInitialContext: ({ configuration, serviceDir }) => {
    return {
      isInServiceContext: Boolean(serviceDir),
      isLoggedIntoDashboard: isAuthenticated(),
      hasLocalAwsCredentials: hasLocalCredentials(),
      isDashboardEnabled: Boolean(
        configuration &&
          configuration.org &&
          configuration.app &&
          (!configuration.console || configuration.dashboard)
      ),
      isConsoleEnabled: Boolean(configuration && configuration.org && configuration.console),
    };
  },
  writeOrgAppAndConsole: async (
    orgName,
    appName,
    { isConsole, isDashboard },
    { configurationFilename, serviceDir, configuration }
  ) => {
    const configurationFilePath = path.resolve(serviceDir, configurationFilename);
    let ymlString = await (async () => {
      if (!yamlExtensions.has(path.extname(configurationFilename))) return null; // Non YAML config
      try {
        return await fsp.readFile(configurationFilePath);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    })();

    if (!ymlString) {
      log.notice(
        'Add the following settings to your serverless configuration file:\n\n' +
          `org: ${orgName}${appName ? `\napp: ${appName}` : ''}${
            isConsole ? '\nconsole: true' : ''
          }${isConsole && isDashboard ? '\ndashboard: true' : ''}`
      );
      return;
    }
    ymlString = ymlString.toString();
    if (isConsole) {
      const consoleMatch = ymlString.match(consolePattern);
      if (consoleMatch) {
        ymlString = ymlString.replace(
          consoleMatch[0],
          `console:${consoleMatch[1].trim() ? ' true' : ''}`
        );
      } else {
        ymlString = `console: true\n${ymlString}`;
      }
    }
    if (isConsole && isDashboard) {
      const dashboardMatch = ymlString.match(dashboardPattern);
      if (dashboardMatch) {
        ymlString = ymlString.replace(dashboardMatch[0], 'dashboard: true');
      } else {
        ymlString = `dashboard: true\n${ymlString}`;
      }
    }

    if (appName) {
      const appMatch = ymlString.match(appPattern);
      if (appMatch) {
        ymlString = ymlString.replace(appMatch[0], `app: ${appName}`);
      } else {
        ymlString = `app: ${appName}\n${ymlString}`;
      }
    }

    const orgMatch = ymlString.match(orgPattern);
    if (orgMatch) {
      ymlString = ymlString.replace(orgMatch[0], `org: ${orgName}`);
    } else {
      ymlString = `org: ${orgName}\n${ymlString}`;
    }
    await fsp.writeFile(configurationFilePath, ymlString);
    configuration.org = orgName;
    if (appName) configuration.app = appName;
    if (isConsole) {
      if (!configuration.console) configuration.console = true;
      if (isDashboard) configuration.dashboard = true;
    }
  },
  showOnboardingWelcome: memoizee(
    (context) => {
      const isConsole = Boolean(context.options.console || context.configuration.console);
      log.notice(
        `Onboarding "${context.configuration.service}" to the Serverless ${
          isConsole ? 'Console' : 'Dashboard'
        }`
      );
      log.notice();
    },
    { length: 0 }
  ),
};
