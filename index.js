require("dotenv").config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const BUTTON_ID = "verify_accept";
const SETUP_COMMAND_NAME = "setup-verification";

const requiredEnvVars = ["DISCORD_TOKEN", "VERIFIED_ROLE_ID"];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
  process.exit(1);
}

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID || null,
  verifiedRoleId: process.env.VERIFIED_ROLE_ID,
  verificationChannelId: process.env.VERIFICATION_CHANNEL_ID || null,
  embedColor: process.env.EMBED_COLOR || "#5865F2",
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const setupVerificationCommand = new SlashCommandBuilder()
  .setName(SETUP_COMMAND_NAME)
  .setDescription("Post the server verification message.")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel to post the verification message in")
      .addChannelTypes(ChannelType.GuildText)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function buildVerificationMessage() {
  const embed = new EmbedBuilder()
    .setTitle("Welcome to the Server")
    .setDescription(
      [
        "Please read and accept the rules below to access the rest of the server.",
        "",
        "**Rules:**",
        "1. Be respectful. No harassment, hate speech, or personal attacks.",
        "2. No spam, scams, or excessive self-promotion.",
        "3. All content is for informational and entertainment purposes only, not financial advice or guaranteed betting advice.",
        "4. Bet responsibly. Never wager more than you can afford to lose.",
        "5. You must follow the laws and age requirements that apply in your location.",
        "6. Staff may remove content or users that put the community at risk.",
      ].join("\n")
    )
    .setColor(config.embedColor)
    .setFooter({
      text: 'By clicking "Accept & Enter," you confirm that you have read and agree to these rules.',
    });

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_ID)
        .setLabel("Accept & Enter")
        .setStyle(ButtonStyle.Success)
    ),
  ];

  return { embeds: [embed], components };
}

async function resolveVerifiedRole(guild) {
  const role = await guild.roles.fetch(config.verifiedRoleId);

  if (!role) {
    throw new Error(
      `VERIFIED_ROLE_ID (${config.verifiedRoleId}) was not found in guild ${guild.id}.`
    );
  }

  return role;
}

async function registerCommands() {
  const commandData = [setupVerificationCommand.toJSON()];

  if (config.guildId) {
    const guild = await client.guilds.fetch(config.guildId);
    await guild.commands.set(commandData);
    console.log(`Registered slash commands for guild ${guild.id}.`);
    return;
  }

  await client.application.commands.set(commandData);
  console.log("Registered global slash commands.");
}

async function getVerificationChannel(interaction) {
  const selectedChannel = interaction.options.getChannel("channel");

  if (selectedChannel) {
    return selectedChannel;
  }

  if (config.verificationChannelId) {
    return interaction.guild.channels.fetch(config.verificationChannelId);
  }

  return interaction.channel;
}

async function handleSetupVerification(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used inside a server.",
      ephemeral: true,
    });
    return;
  }

  const verificationChannel = await getVerificationChannel(interaction);

  if (!verificationChannel || !verificationChannel.isTextBased()) {
    await interaction.reply({
      content:
        "I couldn't find a valid text channel for the verification message. Check `VERIFICATION_CHANNEL_ID` or pass a channel to the command.",
      ephemeral: true,
    });
    return;
  }

  let verifiedRole;

  try {
    verifiedRole = await resolveVerifiedRole(interaction.guild);
  } catch (error) {
    await interaction.reply({
      content:
        "I couldn't find the configured verified role. Check `VERIFIED_ROLE_ID` and try again.",
      ephemeral: true,
    });
    console.error("Failed to resolve verified role during setup:", error);
    return;
  }

  const botMember = interaction.guild.members.me;
  const channelPermissions = verificationChannel.permissionsFor(botMember);

  if (!channelPermissions?.has(PermissionFlagsBits.ViewChannel)) {
    await interaction.reply({
      content: "I need permission to view that channel.",
      ephemeral: true,
    });
    return;
  }

  if (!channelPermissions.has(PermissionFlagsBits.SendMessages)) {
    await interaction.reply({
      content: "I need permission to send messages in that channel.",
      ephemeral: true,
    });
    return;
  }

  if (!channelPermissions.has(PermissionFlagsBits.EmbedLinks)) {
    await interaction.reply({
      content: "I need permission to embed links in that channel to post the verification panel.",
      ephemeral: true,
    });
    return;
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: "I need the Manage Roles permission before verification can work.",
      ephemeral: true,
    });
    return;
  }

  if (verifiedRole.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content:
        "My role must be above the verified role in the server role list before I can assign it.",
      ephemeral: true,
    });
    return;
  }

  const message = await verificationChannel.send(buildVerificationMessage());

  await interaction.reply({
    content: `Verification message posted in ${verificationChannel}.`,
    ephemeral: true,
  });

  console.log(
    `Posted verification message ${message.id} in channel ${verificationChannel.id}.`
  );
}

async function handleVerifyButton(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This button only works inside a server.",
      ephemeral: true,
    });
    return;
  }

  let verifiedRole;

  try {
    verifiedRole = await resolveVerifiedRole(interaction.guild);
  } catch (error) {
    await interaction.reply({
      content:
        "Verification is temporarily unavailable because the verified role is not configured correctly.",
      ephemeral: true,
    });
    console.error("Failed to resolve verified role during button press:", error);
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (member.roles.cache.has(verifiedRole.id)) {
    await interaction.reply({
      content: "You are already verified and have access to the server.",
      ephemeral: true,
    });
    return;
  }

  const botMember = interaction.guild.members.me;

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content:
        "I can't verify you right now because I am missing the Manage Roles permission.",
      ephemeral: true,
    });
    return;
  }

  if (verifiedRole.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content:
        "I can't verify you right now because my role is below the verified role in the server settings.",
      ephemeral: true,
    });
    return;
  }

  try {
    await member.roles.add(
      verifiedRole,
      "User accepted the server rules via the verification button."
    );

    await interaction.reply({
      content: "You are verified. Welcome in!",
      ephemeral: true,
    });
  } catch (error) {
    console.error("Failed to assign the verified role:", error);
    await interaction.reply({
      content:
        "I couldn't complete verification right now. Please try again in a moment or contact a staff member.",
      ephemeral: true,
    });
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  try {
    await registerCommands();
    console.log("Verification system is ready.");
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === SETUP_COMMAND_NAME) {
        await handleSetupVerification(interaction);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === BUTTON_ID) {
      await handleVerifyButton(interaction);
    }
  } catch (error) {
    console.error("Unhandled interaction error:", error);

    if (!interaction.isRepliable()) {
      return;
    }

    const reply = {
      content: "Something went wrong while handling that action.",
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply).catch(() => { });
      return;
    }

    await interaction.reply(reply).catch(() => { });
  }
});

client.login(config.token);
