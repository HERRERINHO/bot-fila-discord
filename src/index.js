require("dotenv").config();
const {Client,GatewayIntentBits,Events,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,ModalBuilder,TextInputBuilder,TextInputStyle,StringSelectMenuBuilder,ChannelSelectMenuBuilder,RoleSelectMenuBuilder}=require("discord.js");
const db=require("./db");
const client=new Client({intents:[GatewayIntentBits.Guilds]});

function getQueue(id){return db.prepare("SELECT * FROM queues WHERE id=?").get(id)}
function members(id){return db.prepare("SELECT user_id FROM queue_members WHERE queue_id=? ORDER BY joined_at").all(id)}
function blocked(g,u){return !!db.prepare("SELECT 1 FROM blacklist WHERE guild_id=? AND user_id=?").get(g,u)}

function configPanel(guildId){
 const qs=db.prepare("SELECT * FROM queues WHERE guild_id=? ORDER BY id").all(guildId);
 const e=new EmbedBuilder().setTitle("⚙️ MASTER BOOT • CONFIGURAÇÃO DE FILAS")
  .setDescription("Use este painel para criar e administrar cada fila separadamente.\n\n**Ações disponíveis**\n🎟️ Criar fila\n⚙️ Gerenciar uma fila existente\n🟢 Abrir / 🔴 Fechar\n🧹 Resetar jogadores\n🗑️ Excluir fila")
  .addFields({name:"📋 Filas cadastradas",value:qs.length?qs.map(q=>`**#${q.id}** • ${q.name} • ${q.format}x${q.format} • ${q.price} • ${q.status}`).join("\n").slice(0,1024):"_Nenhuma fila cadastrada._"})
  .setFooter({text:"MASTER BOOT • Painel administrativo"});
 const rows=[
  new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("cfg:create").setLabel("CRIAR FILA").setEmoji("🎟️").setStyle(ButtonStyle.Success),
   new ButtonBuilder().setCustomId("cfg:manage").setLabel("GERENCIAR FILA").setEmoji("⚙️").setStyle(ButtonStyle.Primary)
  ),
  new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("cfg:refresh").setLabel("ATUALIZAR PAINEL").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
  )
 ];
 return {embeds:[e],components:rows};
}
function panel(q){
 const ms=members(q.id), max=q.format*2;
 const count=ms.length;
 const list=ms.length
  ? ms.map((m,i)=>`**${String(i+1).padStart(2,"0")}**  <@${m.user_id}>`).join("\n")
  : "_Aguardando jogadores..._";
 const remaining=Math.max(0,max-count);
 const progress="▰".repeat(Math.min(10,Math.round((count/max)*10)))+"▱".repeat(Math.max(0,10-Math.round((count/max)*10)));
 const e=new EmbedBuilder()
  .setTitle(`${q.emoji}  ${q.name}`)
  .setDescription(`**${q.format}x${q.format} • ${q.platform} • ${q.mode}**\n\n`+
   `${q.status==="open"?"🟢 **FILA ABERTA**":"🔴 **FILA FECHADA**"}\n`+
   `👥 **Jogadores:** ${count}/${max}\n`+
   `▰▰▰▰▰▰▰▰▰▰\n`+
   `${remaining>0?`⏳ Faltam **${remaining}** jogador(es)`:"🔥 **FILA COMPLETA — PARTIDA SENDO MONTADA**"}`)
  .addFields(
   {name:"💰 Taxa de inscrição",value:`**${q.price}**`,inline:true},
   {name:"🎮 Plataforma",value:`**${q.platform}**`,inline:true},
   {name:"🧊 Modo",value:`**${q.mode}**`,inline:true},
   {name:"👑 Jogadores",value:list.slice(0,1024)}
  )
  .setFooter({text:`MASTER BOOT • Fila #${q.id}`})
  .setTimestamp();
 if(q.image_url)e.setThumbnail(q.image_url);
 const row=new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`join:${q.id}`).setLabel("ENTRAR NA FILA").setEmoji("🎟️").setStyle(ButtonStyle.Success).setDisabled(q.status!=="open"||count>=max),
  new ButtonBuilder().setCustomId(`leave:${q.id}`).setLabel("SAIR").setEmoji("🚪").setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId(`view:${q.id}`).setLabel("JOGADORES").setEmoji("👥").setStyle(ButtonStyle.Secondary)
 );
 return {embeds:[e],components:[row]};
}
async function updatePanel(q){
 if(!q?.message_id)return;
 const ch=await client.channels.fetch(q.channel_id).catch(()=>null);
 const m=ch&&await ch.messages.fetch(q.message_id).catch(()=>null);
 if(m)await m.edit(panel(q)).catch(()=>{});
}
async function startMatch(q,guild){
 const all=members(q.id), need=q.format*2;
 if(all.length<need)return;
 const players=all.slice(0,need);
 const r=db.prepare("INSERT INTO matches(queue_id,guild_id,created_at) VALUES(?,?,?)").run(q.id,guild.id,Date.now());
 const add=db.prepare("INSERT INTO match_players(match_id,user_id) VALUES(?,?)");
 const rem=db.prepare("DELETE FROM queue_members WHERE queue_id=? AND user_id=?");
 for(const p of players){add.run(r.lastInsertRowid,p.user_id);rem.run(q.id,p.user_id)}
 const ch=await guild.channels.fetch(q.channel_id).catch(()=>null);
 if(ch?.isTextBased()){
  const th=await ch.threads.create({name:`Partida #${r.lastInsertRowid} • ${q.name}`,type:ChannelType.PublicThread,reason:"Nova partida"}).catch(()=>null);
  if(th){
   db.prepare("UPDATE matches SET thread_id=? WHERE id=?").run(th.id,r.lastInsertRowid);
   const a=players.slice(0,q.format).map(x=>`<@${x.user_id}>`).join(", ");
   const b=players.slice(q.format).map(x=>`<@${x.user_id}>`).join(", ");
   await th.send({embeds:[new EmbedBuilder().setTitle("🎮 Nova partida").setDescription(`**${q.name}**\n\n**Time A**\n${a}\n\n**Time B**\n${b}`).setFooter({text:`Partida #${r.lastInsertRowid}`})]});
  }
 }
 await updatePanel(q);
}
client.once(Events.ClientReady,c=>console.log(`Online como ${c.user.tag}`));

client.on(Events.InteractionCreate,async i=>{
 try {
 if(i.isButton()){
  if(i.customId==="cfg:create"){
   const modal=new ModalBuilder().setCustomId("cfgmodal:create").setTitle("Criar nova fila");
   const fields=[
    ["nome","Nome da fila","Ex.: 1x1 | Fila"],
    ["formato","Formato","1, 2, 3, 4 ou 5 (jogadores por time)"],
    ["preco","Taxa de inscrição","Ex.: R$ 5,00"],
    ["plataforma","Plataforma","Emulador ou Mobile"],
    ["modo","Modo","Gelo normal ou Gelo infinito"]
   ].map(([id,label,ph])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(ph).setStyle(TextInputStyle.Short).setRequired(true)));
   modal.addComponents(...fields);
   return i.showModal(modal);
  }
  if(i.customId==="cfg:refresh")return i.update(configPanel(i.guildId));
  if(i.customId==="cfg:manage"){
   const qs=db.prepare("SELECT id,name FROM queues WHERE guild_id=? ORDER BY id").all(i.guildId);
   if(!qs.length)return i.reply({content:"Nenhuma fila cadastrada.",ephemeral:true});
   const menu=new StringSelectMenuBuilder().setCustomId("cfg:select").setPlaceholder("Selecione a fila para gerenciar").addOptions(qs.slice(0,25).map(q=>({label:q.name.slice(0,100),value:String(q.id),description:"Fila #"+q.id})));
   return i.reply({content:"⚙️ **Gerenciar fila**",components:[new ActionRowBuilder().addComponents(menu)],ephemeral:true});
  }
  if(i.customId.startsWith("cfgedit:")){
   const id=Number(i.customId.split(":")[1]),q=getQueue(id);
   if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
   const modal=new ModalBuilder().setCustomId(`cfgmodal:edit:${id}`).setTitle(`Editar fila #${id}`);
   const vals=[
    ["nome","Nome da fila",q.name],
    ["preco","Taxa de inscrição",q.price],
    ["formato","Formato (1-5)",String(q.format)],
    ["plataforma","Plataforma",q.platform],
    ["modo","Modo",q.mode]
   ].map(([id,label,value])=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setValue(value||"").setStyle(TextInputStyle.Short).setRequired(true)));
   return i.showModal(modal.addComponents(...vals));
  }
  if(i.customId.startsWith("cfgimage:")){
   const id=Number(i.customId.split(":")[1]),q=getQueue(id);
   if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
   const modal=new ModalBuilder().setCustomId(`cfgmodal:image:${id}`).setTitle("Logo da fila");
   modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("url").setLabel("URL da imagem").setPlaceholder("https://...").setValue(q.image_url||"").setStyle(TextInputStyle.Short).setRequired(false)));
   return i.showModal(modal);
  }
  if(i.customId.startsWith("cfgchannel:")){
   const id=Number(i.customId.split(":")[1]),q=getQueue(id);
   if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
   const menu=new ChannelSelectMenuBuilder().setCustomId(`cfgselect:channel:${id}`).setPlaceholder("Escolha o canal da fila").setChannelTypes(ChannelType.GuildText);
   return i.reply({content:"📢 **Selecione o canal onde a fila será publicada.**",components:[new ActionRowBuilder().addComponents(menu)],ephemeral:true});
  }
  if(i.customId.startsWith("cfgrole:")){
   const id=Number(i.customId.split(":")[1]),q=getQueue(id);
   if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
   const menu=new RoleSelectMenuBuilder().setCustomId(`cfgselect:role:${id}`).setPlaceholder("Escolha o cargo permitido");
   return i.reply({content:"🛡️ **Selecione o cargo necessário para entrar na fila.**",components:[new ActionRowBuilder().addComponents(menu),new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cfgroleclear:${id}`).setLabel("REMOVER RESTRIÇÃO").setStyle(ButtonStyle.Danger))],ephemeral:true});
  }
  if(i.customId.startsWith("cfgroleclear:")){
   const id=Number(i.customId.split(":")[1]),q=getQueue(id);
   if(!q||q.guild_id!==i.guildId)return i.update({content:"Fila inválida.",components:[]});
   db.prepare("UPDATE queues SET role_id=NULL WHERE id=?").run(id);
   return i.update({content:"✅ Restrição de cargo removida.",components:[]});
  }
  if(i.customId.startsWith("cfgselect:channel:")){
   const id=Number(i.customId.split(":")[2]),q=getQueue(id),channelId=i.values[0];
   if(!q||q.guild_id!==i.guildId)return i.update({content:"Fila inválida.",components:[]});
   const oldCh=await i.guild.channels.fetch(q.channel_id).catch(()=>null);
   const oldMsg=q.message_id&&oldCh?.messages?await oldCh.messages.fetch(q.message_id).catch(()=>null):null;
   const ch=await i.guild.channels.fetch(channelId).catch(()=>null);
   if(!ch?.isTextBased())return i.update({content:"Canal inválido.",components:[]});
   const msg=await ch.send(panel(q)).catch(()=>null);
   if(!msg)return i.update({content:"❌ Não consegui publicar nesse canal. Verifique as permissões.",components:[]});
   db.prepare("UPDATE queues SET channel_id=?,message_id=? WHERE id=?").run(channelId,msg.id,id);
   if(oldMsg)await oldMsg.delete().catch(()=>{});
   return i.update({content:`✅ Fila **#${id}** movida para <#${channelId}>.`,components:[]});
  }
  if(i.customId.startsWith("cfgselect:role:")){
   const id=Number(i.customId.split(":")[2]),q=getQueue(id),roleId=i.values[0];
   if(!q||q.guild_id!==i.guildId)return i.update({content:"Fila inválida.",components:[]});
   db.prepare("UPDATE queues SET role_id=? WHERE id=?").run(roleId,id);
   return i.update({content:`✅ Cargo <@&${roleId}> definido para a fila **#${id}**.`,components:[]});
  }
  if(i.customId.startsWith("cfgact:")){
   const [,action,idRaw]=i.customId.split(":"); const id=Number(idRaw); const q=getQueue(id);
   if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
   if(action==="open"||action==="close"){db.prepare("UPDATE queues SET status=? WHERE id=?").run(action==="open"?"open":"closed",id);await updatePanel(getQueue(id));return i.update({content:`✅ Fila **#${id}** ${action==="open"?"aberta":"fechada"}.`,components:[]});}
   if(action==="reset"){db.prepare("DELETE FROM queue_members WHERE queue_id=?").run(id);await updatePanel(getQueue(id));return i.update({content:`🧹 Fila **#${id}** resetada.`,components:[]});}
   if(action==="delete"){db.prepare("DELETE FROM queue_members WHERE queue_id=?").run(id);db.prepare("DELETE FROM queues WHERE id=?").run(id);return i.update({content:`🗑️ Fila **#${id}** excluída.`,components:[]});}
  }
  const [action,idRaw]=i.customId.split(":"); const id=Number(idRaw); const q=getQueue(id);
  if(!q)return i.reply({content:"Fila não encontrada.",ephemeral:true});
  if(action==="view"){
   const ms=members(id); return i.reply({content:ms.length?ms.map((m,n)=>`${n+1}. <@${m.user_id}>`).join("\n"):"Fila vazia.",ephemeral:true});
  }
  if(action==="join"){
   if(q.status!=="open")return i.reply({content:"🔴 Esta fila está fechada.",ephemeral:true});
   if(blocked(i.guildId,i.user.id))return i.reply({content:"⛔ Você não pode entrar nesta fila.",ephemeral:true});
   if(q.role_id&&!i.member.roles.cache.has(q.role_id))return i.reply({content:"Você não possui o cargo necessário.",ephemeral:true});
   if(db.prepare("SELECT 1 FROM queue_members WHERE queue_id=? AND user_id=?").get(id,i.user.id))return i.reply({content:"⚠️ Você já está na fila.",ephemeral:true});
   db.prepare("INSERT INTO queue_members(queue_id,user_id,joined_at) VALUES(?,?,?)").run(id,i.user.id,Date.now());
   const before=members(id).findIndex(x=>x.user_id===i.user.id)+1;
   await startMatch(q,i.guild); await updatePanel(getQueue(id));
   return i.reply({content:`✅ Você entrou na fila. Posição: **${before}**.`,ephemeral:true});
  }
  if(action==="leave"){
   const r=db.prepare("DELETE FROM queue_members WHERE queue_id=? AND user_id=?").run(id,i.user.id);
   if(!r.changes)return i.reply({content:"Você não está na fila.",ephemeral:true});
   await updatePanel(q); return i.reply({content:"✅ Você saiu da fila.",ephemeral:true});
  }
 }
 if(i.isModalSubmit() && i.customId==="cfgmodal:create"){
  const nome=i.fields.getTextInputValue("nome").trim();
  const formato=Number(i.fields.getTextInputValue("formato").trim());
  const precoRaw=i.fields.getTextInputValue("preco").trim();
  const plataforma=i.fields.getTextInputValue("plataforma").trim();
  const modo=i.fields.getTextInputValue("modo").trim();
  if(![1,2,3,4,5].includes(formato))return i.reply({content:"❌ Formato inválido. Use 1, 2, 3, 4 ou 5.",ephemeral:true});
  if(!/^R\\$\\s*\\d{1,4}(?:[.,]\\d{2})?$/.test(precoRaw))return i.reply({content:"❌ Preço inválido. Ex.: **R$ 5,00**.",ephemeral:true});
  if(!["Emulador","Mobile"].includes(plataforma))return i.reply({content:"❌ Plataforma inválida.",ephemeral:true});
  if(!["Gelo normal","Gelo infinito"].includes(modo))return i.reply({content:"❌ Modo inválido.",ephemeral:true});
  const r=db.prepare("INSERT INTO queues(guild_id,name,format,channel_id,created_at,role_id,price,platform,mode,image_url) VALUES(?,?,?,?,?,?,?,?,?,?)").run(i.guildId,nome,formato,i.channelId,Date.now(),null,precoRaw,plataforma,modo,null);
  const q=getQueue(r.lastInsertRowid),msg=await i.channel.send(panel(q));
  db.prepare("UPDATE queues SET message_id=? WHERE id=?").run(msg.id,q.id);
  return i.reply({content:`✅ Fila **${nome}** criada como **#${q.id}**.`,ephemeral:true});
 }
 if(i.isModalSubmit() && i.customId.startsWith("cfgmodal:edit:")){
  const id=Number(i.customId.split(":")[2]),q=getQueue(id);
  if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
  const nome=i.fields.getTextInputValue("nome").trim(),preco=i.fields.getTextInputValue("preco").trim();
  const formato=Number(i.fields.getTextInputValue("formato").trim()),plataforma=i.fields.getTextInputValue("plataforma").trim(),modo=i.fields.getTextInputValue("modo").trim();
  if(![1,2,3,4,5].includes(formato))return i.reply({content:"❌ Formato inválido.",ephemeral:true});
  if(!/^R\\$\\s*\\d{1,4}(?:[.,]\\d{2})?$/.test(preco))return i.reply({content:"❌ Preço inválido. Ex.: R$ 5,00.",ephemeral:true});
  if(!["Emulador","Mobile"].includes(plataforma)||!["Gelo normal","Gelo infinito"].includes(modo))return i.reply({content:"❌ Plataforma ou modo inválido.",ephemeral:true});
  db.prepare("UPDATE queues SET name=?,format=?,price=?,platform=?,mode=? WHERE id=?").run(nome,formato,preco,plataforma,modo,id);
  await updatePanel(getQueue(id));
  return i.reply({content:`✅ Fila **#${id}** atualizada.`,ephemeral:true});
 }
 if(i.isModalSubmit() && i.customId.startsWith("cfgmodal:image:")){
  const id=Number(i.customId.split(":")[2]),q=getQueue(id);
  if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
  const url=i.fields.getTextInputValue("url").trim();
  if(url&&!/^https?:\\/\\//i.test(url))return i.reply({content:"❌ URL inválida. Use uma URL começando por https://",ephemeral:true});
  db.prepare("UPDATE queues SET image_url=? WHERE id=?").run(url||null,id);
  await updatePanel(getQueue(id));
  return i.reply({content:`✅ Logo da fila **#${id}** atualizada.`,ephemeral:true});
 }
 if(i.isChannelSelectMenu() && i.customId.startsWith("cfgselect:channel:")){
  const id=Number(i.customId.split(":")[2]),q=getQueue(id),channelId=i.values[0];
  if(!q||q.guild_id!==i.guildId)return i.update({content:"Fila inválida.",components:[]});
  const oldCh=await i.guild.channels.fetch(q.channel_id).catch(()=>null);
  const oldMsg=q.message_id&&oldCh?.messages?await oldCh.messages.fetch(q.message_id).catch(()=>null):null;
  const ch=await i.guild.channels.fetch(channelId).catch(()=>null);
  if(!ch?.isTextBased())return i.update({content:"Canal inválido.",components:[]});
  const msg=await ch.send(panel(q)).catch(()=>null);
  if(!msg)return i.update({content:"❌ Não consegui publicar nesse canal. Verifique as permissões.",components:[]});
  db.prepare("UPDATE queues SET channel_id=?,message_id=? WHERE id=?").run(channelId,msg.id,id);
  if(oldMsg)await oldMsg.delete().catch(()=>{});
  return i.update({content:`✅ Fila **#${id}** movida para <#${channelId}>.`,components:[]});
 }
 if(i.isRoleSelectMenu() && i.customId.startsWith("cfgselect:role:")){
  const id=Number(i.customId.split(":")[2]),q=getQueue(id),roleId=i.values[0];
  if(!q||q.guild_id!==i.guildId)return i.update({content:"Fila inválida.",components:[]});
  db.prepare("UPDATE queues SET role_id=? WHERE id=?").run(roleId,id);
  return i.update({content:`✅ Cargo <@&${roleId}> definido para a fila **#${id}**.`,components:[]});
 }
 if(i.isStringSelectMenu() && i.customId==="cfg:select"){
  const id=Number(i.values[0]),q=getQueue(id);
  if(!q||q.guild_id!==i.guildId)return i.update({content:"Fila inválida.",components:[]});
  const e=new EmbedBuilder().setTitle(`⚙️ Gerenciar • #${q.id} ${q.name}`).setDescription(`**${q.format}x${q.format} • ${q.platform} • ${q.mode} • ${q.price}**\nStatus: ${q.status==="open"?"🟢 Aberta":"🔴 Fechada"}\nJogadores: **${members(q.id).length}/${q.format*2}**`);
  const rows=[
   new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfgedit:${id}`).setLabel("EDITAR DADOS").setEmoji("✏️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cfgimage:${id}`).setLabel("LOGO").setEmoji("🖼️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfgchannel:${id}`).setLabel("CANAL").setEmoji("📢").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfgrole:${id}`).setLabel("CARGO").setEmoji("🛡️").setStyle(ButtonStyle.Secondary)
   ),
   new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfgact:open:${id}`).setLabel("ABRIR").setEmoji("🟢").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cfgact:close:${id}`).setLabel("FECHAR").setEmoji("🔴").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cfgact:reset:${id}`).setLabel("RESETAR").setEmoji("🧹").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfgact:delete:${id}`).setLabel("EXCLUIR").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
   )
  ];
  return i.update({embeds:[e],components:rows});
 }
 if(!i.isChatInputCommand())return;
 const sub=i.options.getSubcommand(false);
 if(i.commandName==="painel"){await i.deferReply({ephemeral:true});return i.editReply(configPanel(i.guildId));}
 if(i.commandName==="fila"){
  if(sub==="criar"){
   const nome=i.options.getString("nome",true), formato=i.options.getInteger("formato",true), role=i.options.getRole("cargo",false);
   const precoRaw=i.options.getString("preco",true).trim();
   const plataforma=i.options.getString("plataforma",true);
   const modo=i.options.getString("modo",true);
   const imagem=i.options.getAttachment("imagem",false);
   const preco=/^R\\$\\s*\\d{1,4}(?:[.,]\\d{2})?$/.test(precoRaw)?precoRaw:"";
   if(!preco)return i.reply({content:"❌ Preço inválido. Use, por exemplo, **R$ 5,00**.",ephemeral:true});
   const r=db.prepare("INSERT INTO queues(guild_id,name,format,channel_id,created_at,role_id,price,platform,mode,image_url) VALUES(?,?,?,?,?,?,?,?,?,?)").run(i.guildId,nome,formato,i.channelId,Date.now(),role?.id||null,preco,plataforma,modo,imagem?.url||null);
   const q=getQueue(r.lastInsertRowid), msg=await i.channel.send(panel(q));
   db.prepare("UPDATE queues SET message_id=? WHERE id=?").run(msg.id,q.id);
   return i.reply({content:`✅ Fila **${nome}** criada como #${q.id}.`,ephemeral:true});
  }
  if(sub==="listar"){
   const qs=db.prepare("SELECT * FROM queues WHERE guild_id=? ORDER BY id").all(i.guildId);
   return i.reply({content:qs.length?qs.map(q=>`**#${q.id}** ${q.name} • ${q.format}x${q.format} • ${q.platform} • ${q.mode} • ${q.price} • ${q.status} • ${members(q.id).length}/${q.format*2}`).join("\n"):"Nenhuma fila criada.",ephemeral:true});
  }
  if(sub==="mediador"){
   const u=i.options.getUser("usuario",true);
   db.prepare(`INSERT INTO stats(guild_id,user_id,mediator_count) VALUES(?,?,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET mediator_count=mediator_count+1`).run(i.guildId,u.id);
   return i.reply({content:`✅ <@${u.id}> registrado como mediador.`,ephemeral:true});
  }
  const id=i.options.getInteger("id",false),q=id&&getQueue(id);
  if(!q||q.guild_id!==i.guildId)return i.reply({content:"Fila inválida.",ephemeral:true});
  if(sub==="fechar"||sub==="abrir"){db.prepare("UPDATE queues SET status=? WHERE id=?").run(sub==="abrir"?"open":"closed",id);await updatePanel(getQueue(id));return i.reply({content:"✅ Status atualizado.",ephemeral:true})}
  if(sub==="resetar"){db.prepare("DELETE FROM queue_members WHERE queue_id=?").run(id);await updatePanel(getQueue(id));return i.reply({content:"🧹 Fila resetada.",ephemeral:true})}
  if(sub==="deletar"){db.prepare("DELETE FROM queue_members WHERE queue_id=?").run(id);db.prepare("DELETE FROM queues WHERE id=?").run(id);return i.reply({content:"🗑️ Fila excluída.",ephemeral:true})}
  if(sub==="remover"){const u=i.options.getUser("usuario",true),r=db.prepare("DELETE FROM queue_members WHERE queue_id=? AND user_id=?").run(id,u.id);await updatePanel(q);return i.reply({content:r.changes?`✅ <@${u.id}> removido.`:"Usuário não estava na fila.",ephemeral:true})}
  if(sub==="proxima"){const m=members(id)[0];if(!m)return i.reply({content:"Fila vazia.",ephemeral:true});db.prepare("DELETE FROM queue_members WHERE queue_id=? AND user_id=?").run(id,m.user_id);await updatePanel(q);return i.reply(`🔔 Próximo: <@${m.user_id}>`)}
 }
 if(i.commandName==="perfil"){
  const s=db.prepare("SELECT * FROM stats WHERE guild_id=? AND user_id=?").get(i.guildId,i.user.id)||{matches:0,wins:0,mediator_count:0};
  return i.reply({embeds:[new EmbedBuilder().setTitle(`👤 Perfil de ${i.user.username}`).addFields({name:"Partidas",value:String(s.matches),inline:true},{name:"Vitórias",value:String(s.wins),inline:true},{name:"Mediações",value:String(s.mediator_count),inline:true})],ephemeral:true});
 }
 if(i.commandName==="ranking"){
  const rows=db.prepare("SELECT * FROM stats WHERE guild_id=? ORDER BY matches DESC,mediator_count DESC LIMIT 10").all(i.guildId);
  return i.reply({content:rows.length?rows.map((x,n)=>`${n+1}. <@${x.user_id}> — ${x.matches} partidas • ${x.mediator_count} mediações`).join("\n"):"Ainda não há estatísticas.",ephemeral:true});
 }
 if(i.commandName==="blacklist"){
  const u=i.options.getUser("usuario",true);
  if(sub==="adicionar"){const motivo=i.options.getString("motivo",false)||"Sem motivo informado";db.prepare("INSERT OR REPLACE INTO blacklist(guild_id,user_id,reason) VALUES(?,?,?)").run(i.guildId,u.id,motivo);return i.reply({content:`⛔ <@${u.id}> entrou na blacklist.`,ephemeral:true})}
  db.prepare("DELETE FROM blacklist WHERE guild_id=? AND user_id=?").run(i.guildId,u.id);return i.reply({content:`✅ <@${u.id}> saiu da blacklist.`,ephemeral:true});
 } 
 } catch(err) {
  console.error("Interaction error:",err);
  try {
   if(i.deferred) await i.editReply({content:"❌ Ocorreu um erro. Veja os logs do Railway.",embeds:[],components:[]});
   else if(!i.replied) await i.reply({content:"❌ Ocorreu um erro. Veja os logs do Railway.",ephemeral:true});
  } catch(e) {}
 }
});
client.login(process.env.DISCORD_TOKEN);