require("dotenv").config();
const {REST,Routes,SlashCommandBuilder,PermissionFlagsBits}=require("discord.js");

const commands=[
  new SlashCommandBuilder()
    .setName("fila")
    .setDescription("Sistema de filas")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName("criar").setDescription("Cria uma fila")
      .addStringOption(o=>o.setName("nome").setDescription("Nome").setRequired(true))
      .addIntegerOption(o=>o.setName("formato").setDescription("Jogadores por time").setRequired(true)
        .addChoices({name:"1x1",value:1},{name:"2x2",value:2},{name:"3x3",value:3},{name:"4x4",value:4},{name:"5x5",value:5}))
      .addStringOption(o=>o.setName("preco").setDescription("Taxa de inscrição, ex.: R$ 5,00").setRequired(true))
      .addStringOption(o=>o.setName("plataforma").setDescription("Plataforma da fila").setRequired(true)
        .addChoices({name:"Emulador",value:"Emulador"},{name:"Mobile",value:"Mobile"}))
      .addRoleOption(o=>o.setName("cargo").setDescription("Cargo permitido")))
    .addSubcommand(s=>s.setName("listar").setDescription("Lista as filas"))
    .addSubcommand(s=>s.setName("fechar").setDescription("Fecha uma fila")
      .addIntegerOption(o=>o.setName("id").setDescription("ID").setRequired(true)))
    .addSubcommand(s=>s.setName("abrir").setDescription("Abre uma fila")
      .addIntegerOption(o=>o.setName("id").setDescription("ID").setRequired(true)))
    .addSubcommand(s=>s.setName("deletar").setDescription("Exclui uma fila")
      .addIntegerOption(o=>o.setName("id").setDescription("ID").setRequired(true)))
    .addSubcommand(s=>s.setName("resetar").setDescription("Limpa uma fila")
      .addIntegerOption(o=>o.setName("id").setDescription("ID").setRequired(true)))
    .addSubcommand(s=>s.setName("proxima").setDescription("Chama a próxima")
      .addIntegerOption(o=>o.setName("id").setDescription("ID").setRequired(true)))
    .addSubcommand(s=>s.setName("remover").setDescription("Remove pessoa")
      .addIntegerOption(o=>o.setName("id").setDescription("ID").setRequired(true))
      .addUserOption(o=>o.setName("usuario").setDescription("Usuário").setRequired(true)))
    .addSubcommand(s=>s.setName("mediador").setDescription("Registra mediador")
      .addUserOption(o=>o.setName("usuario").setDescription("Usuário").setRequired(true))),

  new SlashCommandBuilder().setName("perfil").setDescription("Mostra seu perfil"),
  new SlashCommandBuilder().setName("ranking").setDescription("Mostra o ranking"),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Gerencia blacklist")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName("adicionar").setDescription("Adiciona usuário")
      .addUserOption(o=>o.setName("usuario").setDescription("Usuário").setRequired(true))
      .addStringOption(o=>o.setName("motivo").setDescription("Motivo")))
    .addSubcommand(s=>s.setName("remover").setDescription("Remove usuário")
      .addUserOption(o=>o.setName("usuario").setDescription("Usuário").setRequired(true)))
].map(c=>c.toJSON());

async function register(){
  if(!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID){
    throw new Error("DISCORD_TOKEN, CLIENT_ID e GUILD_ID são obrigatórios.");
  }
  const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),
    {body:commands}
  );
  console.log("Comandos registrados.");
}

register().catch(err=>{
  console.error("Falha ao registrar comandos:",err);
  process.exit(1);
});