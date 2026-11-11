import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const conflict = () => { throw Object.assign(new Error('이미 등록된 계정입니다. 다시 로그인해 주세요.'),{status:409}); };
const data = doc => doc.exists ? doc.data() : undefined;
const publicUser = u => ({id:u.id,email:u.email,name:u.name,role:u.role});

export function firestoreRepository(firestore,namespace='main') {
  const base=firestore.collection('moneycheck').doc(namespace);
  const col=name=>base.collection(name);
  const user=id=>col('users').doc(id);
  const entries=(uid,name)=>user(uid).collection(name);
  const settings=col('settings').doc('accounts');
  const rows=async query=>(await query.get()).docs.map(doc=>doc.data());
  const putUnique=async (ref,value,ignore=false)=>{
    try {await ref.create(value);return {changes:1};}
    catch(error){if(ignore&&(error.code===6||error.code==='ALREADY_EXISTS'))return {changes:0};throw error;}
  };
  return {
    cardCompanies: uid=>rows(entries(uid,'card_companies')),
    hasCardCompany: async (uid,name)=>data(await entries(uid,'card_companies').doc(hash(name)).get()),
    addCardCompany: (uid,name)=>entries(uid,'card_companies').doc(hash(name)).set({name}),
    async smsDevice(uid){const d=data(await user(uid).get());return d?.sms_token_hash?{expires:d.sms_expires}:undefined;},
    async setSmsDevice(uid,token,expires){
      await firestore.runTransaction(async tx=>{
        const u=data(await tx.get(user(uid)));if(!u||u.disabled)throw Object.assign(new Error('로그인이 필요합니다.'),{status:401});
        if(u.sms_token_hash)tx.delete(col('sms_devices').doc(u.sms_token_hash));
        tx.set(col('sms_devices').doc(token),{user_id:uid,expires});
        tx.update(user(uid),{sms_token_hash:token,sms_expires:expires});
      });
    },
    async deleteSmsDevice(uid){
      await firestore.runTransaction(async tx=>{const u=data(await tx.get(user(uid)));if(!u)return;
        if(u.sms_token_hash)tx.delete(col('sms_devices').doc(u.sms_token_hash));
        tx.update(user(uid),{sms_token_hash:null,sms_expires:null});});
    },
    async smsUser(token,now){const d=data(await col('sms_devices').doc(token).get());if(!d||d.expires<=now)return undefined;
      const u=data(await user(d.user_id).get());return u&&!u.disabled&&u.sms_token_hash===token?{id:u.id}:undefined;},
    async hasUsers(){return !!data(await settings.get())?.admin_user_id;},
    async findUserByEmail(email){const index=data(await col('emails').doc(hash(email)).get());return index?data(await user(index.user_id).get()):undefined;},
    async sessionUser(token,now){
      const s=data(await col('sessions').doc(token).get());if(!s||s.expires<=now)return undefined;
      const u=data(await user(s.user_id).get());
      return u&&!u.disabled&&u.session_token_hash===token?publicUser(u):undefined;
    },
    async createSession(id,token,expires){
      await firestore.runTransaction(async tx=>{
        const u=data(await tx.get(user(id)));
        if(!u||u.disabled)throw Object.assign(new Error('로그인이 필요합니다.'),{status:401});
        if(u.session_token_hash)tx.delete(col('sessions').doc(u.session_token_hash));
        tx.set(col('sessions').doc(token),{user_id:id,expires});
        tx.update(user(id),{session_token_hash:token});
      });
    },
    async deleteSessions(id){
      await firestore.runTransaction(async tx=>{
        const u=data(await tx.get(user(id)));if(!u)return;
        if(u.session_token_hash)tx.delete(col('sessions').doc(u.session_token_hash));
        tx.update(user(id),{session_token_hash:null});
      });
    },
    async createUser(u,categories){
      const emailRef=col('emails').doc(hash(u.email));
      await firestore.runTransaction(async tx=>{
        const [config,email,existing]=await tx.getAll(settings,emailRef,user(u.id));
        if(email.exists||existing.exists)conflict();
        if(u.role==='admin'&&config.exists&&config.data().admin_user_id)conflict();
        if(u.role!=='admin'&&!config.exists)conflict();
        tx.create(user(u.id),{...u,disabled:0,created_at:new Date().toISOString(),session_token_hash:null,reset_token_hash:null});
        tx.create(emailRef,{user_id:u.id});
        if(u.role==='admin')tx.set(settings,{admin_user_id:u.id});
        for(const c of categories)tx.set(entries(u.id,'categories').doc(hash(c.type+':'+c.name)),c);
      });
    },
    async rateLimit(key,now){
      return firestore.runTransaction(async tx=>{
        const ref=col('rate_limits').doc(key), previous=data(await tx.get(ref));
        const current=previous&&previous.expires>now?{count:previous.count+1,expires:previous.expires}:{count:1,expires:now+15*60000};
        tx.set(ref,current);return current.count;
      });
    },
    async createReset(token,id,expires){
      await firestore.runTransaction(async tx=>{
        const u=data(await tx.get(user(id)));if(!u)return;
        if(u.reset_token_hash)tx.delete(col('resets').doc(u.reset_token_hash));
        tx.set(col('resets').doc(token),{user_id:id,expires});
        tx.update(user(id),{reset_token_hash:token});
      });
    },
    deleteReset: token=>col('resets').doc(token).delete(),
    async consumeReset(token,now,password){
      return firestore.runTransaction(async tx=>{
        const ref=col('resets').doc(token),r=data(await tx.get(ref));
        if(!r||r.expires<=now)return false;
        const u=data(await tx.get(user(r.user_id)));
        if(!u||u.reset_token_hash!==token)return false;
        if(u.session_token_hash)tx.delete(col('sessions').doc(u.session_token_hash));
        tx.update(user(u.id),{password,session_token_hash:null,reset_token_hash:null});
        tx.delete(ref);return true;
      });
    },
    categories: async uid=>(await rows(entries(uid,'categories'))).sort((a,b)=>(a.type+a.name).localeCompare(b.type+b.name,'ko')),
    hasCategory: async (uid,type,name)=>data(await entries(uid,'categories').doc(hash(type+':'+name)).get()),
    addCategory: (uid,type,name)=>entries(uid,'categories').doc(hash(type+':'+name)).set({type,name}),
    exchangeRate: async date=>data(await col('exchange_rates').doc(date).get()),
    saveExchangeRate: (date,rate,rateDate)=>putUnique(col('exchange_rates').doc(date),{rate,rate_date:rateDate},true),
    subscriptions: uid=>rows(entries(uid,'subscriptions').where('active','==',1)),
    async subscription(uid,id){const s=data(await entries(uid,'subscriptions').doc(id).get());return s&&s.active===1?s:undefined;},
    createSubscription: s=>entries(s.user_id,'subscriptions').doc(s.id).create({...s,active:1}),
    updateSubscription: (uid,id,s)=>entries(uid,'subscriptions').doc(id).update({name:s.name,amount:s.amount,currency:s.currency}),
    stopSubscription: (uid,id)=>entries(uid,'subscriptions').doc(id).update({active:0}),
    transactions: async (uid,year)=>(await rows(entries(uid,'transactions').where('date','>=',year+'-01-01').where('date','<=',year+'-12-31'))).filter(t=>t.deleted===0).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)),
    async transaction(uid,id){const t=data(await entries(uid,'transactions').doc(id).get());return t&&t.deleted===0?t:undefined;},
    billingMonths: (uid,id)=>rows(entries(uid,'transactions').where('subscription_id','==',id)),
    createTransaction(t,ignore=false){
      const id=t.subscription_id&&t.billing_month?'bill-'+hash(t.subscription_id+':'+t.billing_month):t.id;
      return putUnique(entries(t.user_id,'transactions').doc(id),{...t,id,deleted:0,memo:t.memo||'',payment_method:t.payment_method||null,card_company:t.payment_method==='card'?t.card_company||null:null},ignore);
    },
    updateTransaction: (uid,id,t)=>entries(uid,'transactions').doc(id).update({type:t.type,amount:t.amount,date:t.date,category:t.category,memo:t.memo,payment_method:t.payment_method||null,card_company:t.payment_method==='card'?t.card_company||null:null}),
    deleteTransaction: (uid,id)=>entries(uid,'transactions').doc(id).update({deleted:1}),
    accountProfiles: async ()=>(await rows(col('users'))).map(u=>({...publicUser(u),disabled:u.disabled,created_at:u.created_at})).sort((a,b)=>a.created_at.localeCompare(b.created_at)),
    activeUsers: async ()=>(await rows(col('users').where('disabled','==',0))).map(u=>({id:u.id})),
    async setDisabled(id,disabled){
      return firestore.runTransaction(async tx=>{
        const u=data(await tx.get(user(id)));if(!u||u.role==='admin')return false;
        tx.update(user(id),{disabled:Number(disabled),session_token_hash:null});
        if(u.session_token_hash)tx.delete(col('sessions').doc(u.session_token_hash));
        return true;
      });
    },
    close: ()=>firestore.terminate(),
  };
}
