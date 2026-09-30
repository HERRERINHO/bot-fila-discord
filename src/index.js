require("dotenv").config();
const {Client,GatewayIntentBits,Events,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType}=require("discord.js");
const db=require("./db");
const client=new Client({intents:[GatewayIntentBits.Guilds]});

function getQueue(id){return db.prepare("SELECT * FROM queues WHERE id=?").get(id)}
function members(id){return db.prepare("SELECT user_id FROM queue_members WHERE queue_id=? ORDER BY joined_at").all(id)}
function blocked(g,u){return !!db.prepare("SELECT 1 FROM blacklist WHERE guild_id=? AND user_id=?").get(g,u)}

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
 if(i.isButton()){
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
 if(!i.isChatInputCommand())return;
 const sub=i.options.getSubcommand(false);
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
});
client.login(process.env.DISCORD_TOKEN);
