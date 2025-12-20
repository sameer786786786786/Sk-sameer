/**
 * Loader Utility
 * Dynamically loads all commands and events
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Load all command modules
 */
function loadCommands() {
  const commandsDir = path.join(__dirname, '../modules/commands');

  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
    global.logger.system('Created commands directory');
  }

  const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
  global.logger.system(`Found ${commandFiles.length} command files`);

  // Track command names and aliases to check for duplicates
  const commandNames = new Set();
  const aliasNames = new Map(); // Maps alias to command name
  const disabledCommands = global.config.disabledCommands || [];

  for (const file of commandFiles) {
    try {
      const filePath = path.join(commandsDir, file);
      const command = require(filePath);

      // Validate command structure
      if (!command.config || !command.config.name) {
        global.logger.warn(`Command ${file} is missing required 'config.name' property`);
        continue;
      }

      const commandName = command.config.name;

      // Skip disabled commands
      if (disabledCommands.includes(commandName)) {
        global.logger.warn(`Skipping disabled command: ${commandName}`);
        continue;
      }

      // Check for duplicate command names
      if (commandNames.has(commandName)) {
        global.logger.error(`Duplicate command name detected: ${commandName} in ${file}. Command not loaded.`);
        continue;
      }

      // Add command name to tracking set
      commandNames.add(commandName);

      // Set command in global client
      global.client.commands.set(commandName, command);

      // Check and set command aliases if they exist
      if (command.config.aliases && Array.isArray(command.config.aliases)) {
        for (const alias of command.config.aliases) {
          // Check for duplicate aliases
          if (commandNames.has(alias)) {
            global.logger.error(`Alias '${alias}' in command ${commandName} conflicts with existing command name. Alias not loaded.`);
            continue;
          }

          if (aliasNames.has(alias)) {
            global.logger.error(`Duplicate alias '${alias}' detected in command ${commandName}. Already used by command ${aliasNames.get(alias)}. Alias not loaded.`);
            continue;
          }

          // Track alias
          aliasNames.set(alias, commandName);

          // Set alias in global client
          global.client.commands.set(alias, command);
          global.logger.debug(`Registered alias: ${alias} -> ${commandName}`);
        }
      }

      global.logger.debug(`Loaded command: ${commandName}`);
    } catch (error) {
      global.logger.error(`Failed to load command ${file}:`, error.message);
    }
  }

  global.logger.system(`Successfully loaded ${commandNames.size} commands with ${aliasNames.size} aliases`);
}

/**
 * Load all event modules
 */
function loadEvents() {
  const eventsDir = path.join(__dirname, '../modules/events');

  if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir, { recursive: true });
    global.logger.system('Created events directory');
  }

  const eventFiles = fs.readdirSync(eventsDir).filter(file => file.endsWith('.js'));
  global.logger.system(`Found ${eventFiles.length} event files`);

  for (const file of eventFiles) {
    try {
      const filePath = path.join(eventsDir, file);
      const event = require(filePath);

      // Validate event structure
      if (!event.config || !event.config.name) {
        global.logger.warn(`Event ${file} is missing required 'config.name' property`);
        continue;
      }

      // Set event in global client
      global.client.events.set(event.config.name, event);
      global.logger.debug(`Loaded event: ${event.config.name}`);
    } catch (error) {
      global.logger.error(`Failed to load event ${file}:`, error.message);
    }
  }

  global.logger.system(`Successfully loaded ${global.client.events.size} events`);
}

/**
 * Reload a specific command
 * @param {string} commandName - Name of command to reload
 * @returns {boolean} Success status
 */
function reloadCommand(commandName) {
  try {
    // Special case: reload all commands
    if (commandName.toLowerCase() === 'all') {
      return reloadAllCommands();
    }

    const commandsDir = path.join(__dirname, '../modules/commands');
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));

    // Track existing command names and aliases (excluding the one being reloaded)
    const existingCommandNames = new Set();
    const existingAliasNames = new Map();
    const disabledCommands = global.config.disabledCommands || [];

    // Build sets of existing commands and aliases (excluding the one being reloaded)
    for (const [key, cmd] of global.client.commands.entries()) {
      if (cmd.config.name !== commandName &&
        !(cmd.config.aliases && cmd.config.aliases.includes(commandName))) {

        if (key === cmd.config.name) {
          existingCommandNames.add(key);
        } else {
          existingAliasNames.set(key, cmd.config.name);
        }
      }
    }

    // Find the command file
    for (const file of commandFiles) {
      const filePath = path.join(commandsDir, file);
      const fileBaseName = path.basename(file, '.js'); // Get filename without .js

      // Clear cache before requiring to get fresh content
      delete require.cache[require.resolve(filePath)];

      const command = require(filePath);

      // Match by: config.name, alias, OR filename
      if (command.config && (
        command.config.name === commandName ||
        fileBaseName === commandName ||
        (command.config.aliases && command.config.aliases.includes(commandName))
      )) {

        // Check if command is disabled
        if (disabledCommands.includes(command.config.name)) {
          global.logger.warn(`Reloading disabled command: ${command.config.name}. Re-enabling and saving to config...`);

          // Remove from disabled list
          const index = disabledCommands.indexOf(command.config.name);
          if (index > -1) {
            disabledCommands.splice(index, 1);
            global.config.disabledCommands = disabledCommands;

            // Save config
            try {
              fs.writeFileSync(
                path.join(__dirname, '../config.json'),
                JSON.stringify(global.config, null, 2)
              );
            } catch (err) {
              global.logger.error(`Failed to save config while re-enabling command: ${err.message}`);
            }
          }
        }

        // Remove command from cache
        delete require.cache[require.resolve(filePath)];

        // Remove command and its aliases from client
        global.client.commands.delete(command.config.name);
        if (command.config.aliases && Array.isArray(command.config.aliases)) {
          command.config.aliases.forEach(alias => {
            global.client.commands.delete(alias);
          });
        }

        // Load the command again
        const newCommand = require(filePath);

        // Validate command structure
        if (!newCommand.config || !newCommand.config.name) {
          global.logger.warn(`Reloaded command ${file} is missing required 'config.name' property`);
          return false;
        }

        const newCommandName = newCommand.config.name;

        // Check for duplicate command name
        if (existingCommandNames.has(newCommandName)) {
          global.logger.error(`Cannot reload: Duplicate command name detected: ${newCommandName}`);
          return false;
        }

        // Set command in global client
        global.client.commands.set(newCommandName, newCommand);

        // Check and set command aliases if they exist
        let aliasesLoaded = 0;
        if (newCommand.config.aliases && Array.isArray(newCommand.config.aliases)) {
          for (const alias of newCommand.config.aliases) {
            // Check for duplicate aliases
            if (existingCommandNames.has(alias)) {
              global.logger.error(`Alias '${alias}' in command ${newCommandName} conflicts with existing command name. Alias not loaded.`);
              continue;
            }

            if (existingAliasNames.has(alias)) {
              global.logger.error(`Duplicate alias '${alias}' detected in command ${newCommandName}. Already used by command ${existingAliasNames.get(alias)}. Alias not loaded.`);
              continue;
            }

            // Set alias in global client
            global.client.commands.set(alias, newCommand);
            aliasesLoaded++;
          }
        }

        global.logger.system(`Reloaded command: ${newCommandName} with ${aliasesLoaded} aliases`);
        return true;
      }
    }

    global.logger.warn(`Command ${commandName} not found for reload`);
    return false;
  } catch (error) {
    global.logger.error(`Failed to reload command ${commandName}:`, error.message);
    return false;
  }
}

/**
 * Validate a command file without loading it into the system
 * Checks for syntax errors and duplicate command names
 * @param {string} filePath - Path to the command file
 * @param {string} [excludeConfigName] - Config name to exclude from duplicate check (for edit scenarios)
 * @returns {{success: boolean, error: string|null, commandName: string|null}}
 */
function validateCommand(filePath, excludeConfigName = null) {
  try {
    // Clear cache and require the file
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);

    // Check if it has required config
    if (!command.config || !command.config.name) {
      return { success: false, error: 'Missing config.name property', commandName: null };
    }

    const commandName = command.config.name;

    // Get existing command names (excluding the command being edited/replaced)
    const existingCommandNames = new Set();
    const existingAliases = new Map();

    for (const [key, cmd] of global.client.commands.entries()) {
      // Skip if this is the command being edited/replaced (match by config.name)
      if (excludeConfigName && cmd.config?.name === excludeConfigName) {
        continue;
      }

      if (key === cmd.config.name) {
        existingCommandNames.add(key);
      } else {
        existingAliases.set(key, cmd.config.name);
      }
    }

    // Check for duplicate command name
    if (existingCommandNames.has(commandName)) {
      return {
        success: false,
        error: `Duplicate command name: "${commandName}" already exists`,
        commandName
      };
    }

    // Check for duplicate aliases
    if (command.config.aliases && Array.isArray(command.config.aliases)) {
      for (const alias of command.config.aliases) {
        if (existingCommandNames.has(alias)) {
          return {
            success: false,
            error: `Alias "${alias}" conflicts with existing command name`,
            commandName
          };
        }
        if (existingAliases.has(alias)) {
          return {
            success: false,
            error: `Alias "${alias}" already used by command "${existingAliases.get(alias)}"`,
            commandName
          };
        }
      }
    }

    // Clear from cache after validation
    delete require.cache[require.resolve(filePath)];

    return { success: true, error: null, commandName };
  } catch (error) {
    return { success: false, error: error.message, commandName: null };
  }
}

/**
 * Reload all commands
 * @returns {boolean} Success status
 */
function reloadAllCommands() {
  try {
    // Clear command cache
    global.client.commands.clear();

    // Reload all commands
    const commandsDir = path.join(__dirname, '../modules/commands');
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    let reloadedCount = 0;
    let aliasesCount = 0;

    // Track command names and aliases to check for duplicates
    const commandNames = new Set();
    const aliasNames = new Map(); // Maps alias to command name
    const disabledCommands = global.config.disabledCommands || [];

    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsDir, file);

        // Remove from cache
        delete require.cache[require.resolve(filePath)];

        // Load the command again
        const command = require(filePath);

        if (!command.config || !command.config.name) {
          global.logger.warn(`Command ${file} is missing required 'config.name' property`);
          continue;
        }

        const commandName = command.config.name;

        // Skip disabled commands
        if (disabledCommands.includes(commandName)) {
          global.logger.warn(`Skipping disabled command: ${commandName}`);
          continue;
        }

        // Check for duplicate command names
        if (commandNames.has(commandName)) {
          global.logger.error(`Duplicate command name detected: ${commandName} in ${file}. Command not loaded.`);
          continue;
        }

        // Add command name to tracking set
        commandNames.add(commandName);

        // Set command in global client
        global.client.commands.set(commandName, command);

        // Check and set command aliases if they exist
        if (command.config.aliases && Array.isArray(command.config.aliases)) {
          for (const alias of command.config.aliases) {
            // Check for duplicate aliases
            if (commandNames.has(alias)) {
              global.logger.error(`Alias '${alias}' in command ${commandName} conflicts with existing command name. Alias not loaded.`);
              continue;
            }

            if (aliasNames.has(alias)) {
              global.logger.error(`Duplicate alias '${alias}' detected in command ${commandName}. Already used by command ${aliasNames.get(alias)}. Alias not loaded.`);
              continue;
            }

            // Track alias
            aliasNames.set(alias, commandName);

            // Set alias in global client
            global.client.commands.set(alias, command);
            aliasesCount++;
          }
        }

        reloadedCount++;
      } catch (error) {
        global.logger.error(`Failed to reload command ${file}:`, error.message);
      }
    }

    global.logger.system(`Successfully reloaded ${reloadedCount}/${commandFiles.length} commands with ${aliasesCount} aliases`);
    return reloadedCount > 0;
  } catch (error) {
    global.logger.error(`Failed to reload all commands:`, error.message);
    return false;
  }
}

/**
 * Disable a specific command
 * @param {string} commandName - Name of command to disable
 * @returns {boolean} Success status
 */
function disableCommand(commandName) {
  try {
    // Special case: disable all commands
    if (commandName.toLowerCase() === 'all') {
      return disableAllCommands();
    }

    // Check if command exists
    const command = global.client.commands.get(commandName);
    if (!command) {
      global.logger.warn(`Command ${commandName} not found for disabling`);
      return false;
    }

    // Don't allow disabling the cmd command
    if (command.config.name === 'cmd') {
      global.logger.warn(`Cannot disable the cmd command as it's protected`);
      return false;
    }

    // Get the actual command name (in case an alias was used)
    const actualCommandName = command.config.name;

    // Initialize disabledCommands array if it doesn't exist
    if (!global.config.disabledCommands) {
      global.config.disabledCommands = [];
    }

    // Check if command is already disabled
    if (global.config.disabledCommands.includes(actualCommandName)) {
      global.logger.warn(`Command ${actualCommandName} is already disabled`);
      return false;
    }

    // Add command to disabled list
    global.config.disabledCommands.push(actualCommandName);

    // Save config
    fs.writeFileSync(
      path.join(__dirname, '../config.json'),
      JSON.stringify(global.config, null, 2)
    );

    // Remove command and its aliases from client
    global.client.commands.delete(actualCommandName);
    if (command.config.aliases && Array.isArray(command.config.aliases)) {
      command.config.aliases.forEach(alias => {
        global.client.commands.delete(alias);
      });
    }

    global.logger.system(`Disabled command: ${actualCommandName}`);
    return true;
  } catch (error) {
    global.logger.error(`Failed to disable command ${commandName}:`, error.message);
    return false;
  }
}

/**
 * Disable all commands except protected ones
 * @returns {boolean} Success status
 */
function disableAllCommands() {
  try {
    // Get all unique command names (excluding aliases)
    const uniqueCommands = new Set();
    for (const [key, cmd] of global.client.commands.entries()) {
      if (key === cmd.config.name) {
        uniqueCommands.add(key);
      }
    }

    // Initialize disabledCommands array if it doesn't exist
    if (!global.config.disabledCommands) {
      global.config.disabledCommands = [];
    }

    let disabledCount = 0;

    // Disable each command
    for (const commandName of uniqueCommands) {
      // Skip the cmd command
      if (commandName === 'cmd') {
        continue;
      }

      // Skip already disabled commands
      if (global.config.disabledCommands.includes(commandName)) {
        continue;
      }

      // Add command to disabled list
      global.config.disabledCommands.push(commandName);
      disabledCount++;
    }

    // Save config
    fs.writeFileSync(
      path.join(__dirname, '../config.json'),
      JSON.stringify(global.config, null, 2)
    );

    // Clear commands except cmd
    const cmdCommand = global.client.commands.get('cmd');
    global.client.commands.clear();
    if (cmdCommand) {
      global.client.commands.set('cmd', cmdCommand);
    }

    global.logger.system(`Disabled ${disabledCount} commands`);
    return disabledCount > 0;
  } catch (error) {
    global.logger.error(`Failed to disable all commands:`, error.message);
    return false;
  }
}

/**
 * Enable a specific command
 * @param {string} commandName - Name of command to enable
 * @returns {boolean} Success status
 */
function enableCommand(commandName) {
  try {
    // Special case: enable all commands
    if (commandName.toLowerCase() === 'all') {
      return enableAllCommands();
    }

    // Initialize disabledCommands array if it doesn't exist
    if (!global.config.disabledCommands) {
      global.config.disabledCommands = [];
    }

    // Check if command is in disabled list
    const index = global.config.disabledCommands.indexOf(commandName);
    if (index === -1) {
      global.logger.warn(`Command ${commandName} is not disabled`);
      return false;
    }

    // Remove command from disabled list
    global.config.disabledCommands.splice(index, 1);

    // Save config
    fs.writeFileSync(
      path.join(__dirname, '../config.json'),
      JSON.stringify(global.config, null, 2)
    );

    // Reload the command
    return reloadCommand(commandName);
  } catch (error) {
    global.logger.error(`Failed to enable command ${commandName}:`, error.message);
    return false;
  }
}

/**
 * Enable all disabled commands
 * @returns {boolean} Success status
 */
function enableAllCommands() {
  try {
    // Check if there are any disabled commands
    if (!global.config.disabledCommands || global.config.disabledCommands.length === 0) {
      global.logger.warn('No disabled commands to enable');
      return false;
    }

    // Clear disabled commands list
    const disabledCount = global.config.disabledCommands.length;
    global.config.disabledCommands = [];

    // Save config
    fs.writeFileSync(
      path.join(__dirname, '../config.json'),
      JSON.stringify(global.config, null, 2)
    );

    // Reload all commands
    reloadAllCommands();

    global.logger.system(`Enabled ${disabledCount} previously disabled commands`);
    return true;
  } catch (error) {
    global.logger.error(`Failed to enable all commands:`, error.message);
    return false;
  }
}

module.exports = {
  loadCommands,
  loadEvents,
  reloadCommand,
  validateCommand,
  reloadAllCommands,
  disableCommand,
  disableAllCommands,
  enableCommand,
  enableAllCommands
};