// 로컬 SQLite 및 기존 PostgreSQL을 같은 업무 단위 인터페이스로 제공한다.
export function sqlRepository(db) {
  return {
    async replacePassword(uid,password,force=false,expected=null){
      const u=await db.prepare('SELECT role FROM users WHERE id=?').get(uid);if(!u||(force&&u.role==='admin'))return false;
      const result=await db.batch([{sql:'UPDATE users SET password=?,must_change_password=? WHERE id=? AND (CAST(? AS TEXT) IS NULL OR password=?)',args:[password,Number(force),uid,expected,expected]},
        ...['sessions','resets','sms_devices'].map(table=>({sql:'DELETE FROM '+table+' WHERE user_id=?',args:[uid]}))]);return !!result[0].changes;
    },
    async categoryOrder(uid){const row=await db.prepare('SELECT value FROM category_orders WHERE user_id=?').get(uid);return row?JSON.parse(row.value):{};},
    setCategoryOrder: (uid,order)=>db.prepare('INSERT INTO category_orders VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value').run(uid,JSON.stringify(order)),
    cardCompanies: uid => db.prepare('SELECT name FROM card_companies WHERE user_id=? ORDER BY name').all(uid),
    hasCardCompany: (uid,name) => db.prepare('SELECT name FROM card_companies WHERE user_id=? AND name=?').get(uid,name),
    addCardCompany: (uid,name) => db.prepare('INSERT OR IGNORE INTO card_companies VALUES (?,?)').run(uid,name),
    smsDevice: uid => db.prepare('SELECT expires FROM sms_devices WHERE user_id=?').get(uid),
    setSmsDevice: (uid,token,expires) => db.prepare('INSERT INTO sms_devices(user_id,token,expires) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires=excluded.expires').run(uid,token,expires),
    deleteSmsDevice: uid => db.prepare('DELETE FROM sms_devices WHERE user_id=?').run(uid),
    smsUser: (token,now) => db.prepare('SELECT u.id FROM sms_devices d JOIN users u ON u.id=d.user_id WHERE d.token=? AND d.expires>? AND u.disabled=0').get(token,now),
    async hasUsers() { return !!await db.prepare('SELECT id FROM users LIMIT 1').get(); },
    findUserByEmail: email => db.prepare('SELECT * FROM users WHERE email=?').get(email),
    sessionUser: (token,now) => db.prepare('SELECT u.id,u.email,u.name,u.role,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.disabled=0').get(token,now),
    async createSession(id,token,expires,now) {
      await db.batch([
        {sql:'UPDATE users SET name=name WHERE id=?',args:[id]},
        {sql:'DELETE FROM sessions WHERE user_id=? OR expires<?',args:[id,now]},
        {sql:'INSERT INTO sessions VALUES (?,?,?)',args:[token,id,expires]},
      ]);
    },
    deleteSessions: id => db.prepare('DELETE FROM sessions WHERE user_id=?').run(id),
    async createUser(user,categories) {
      await db.batch([
        {sql:'INSERT INTO users(id,email,name,password,role) VALUES (?,?,?,?,?)',args:[user.id,user.email,user.name,user.password,user.role]},
        ...categories.map(c=>({sql:'INSERT INTO categories VALUES (?,?,?)',args:[user.id,c.type,c.name]})),
      ]);
    },
    async rateLimit(key,now) {
      await db.prepare('DELETE FROM rate_limits WHERE expires<?').run(now);
      return (await db.prepare('INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count').get(key,now+15*60000)).count;
    },
    async createReset(token,id,expires,now) {
      await db.batch([
        {sql:'DELETE FROM resets WHERE user_id=? OR expires<?',args:[id,now]},
        {sql:'INSERT INTO resets VALUES (?,?,?)',args:[token,id,expires]},
      ]);
    },
    deleteReset: token => db.prepare('DELETE FROM resets WHERE token=?').run(token),
    consumeReset: (token,now,password) => db.consumeReset(token,now,password),
    categories: id => db.prepare('SELECT type,name FROM categories WHERE user_id=? ORDER BY type,name').all(id),
    hasCategory: (id,type,name) => db.prepare('SELECT name FROM categories WHERE user_id=? AND type=? AND name=?').get(id,type,name),
    addCategory: (id,type,name) => db.prepare('INSERT OR IGNORE INTO categories VALUES (?,?,?)').run(id,type,name),
    exchangeRate: date => db.prepare('SELECT rate,rate_date FROM exchange_rates WHERE date=?').get(date),
    saveExchangeRate: (date,rate,rateDate) => db.prepare('INSERT OR IGNORE INTO exchange_rates VALUES (?,?,?)').run(date,rate,rateDate),
    subscriptions: id => db.prepare('SELECT * FROM subscriptions WHERE user_id=? AND active=1').all(id),
    subscription: (uid,id) => db.prepare('SELECT * FROM subscriptions WHERE id=? AND user_id=? AND active=1').get(id,uid),
    createSubscription: s => db.prepare('INSERT INTO subscriptions(id,user_id,name,amount,currency,original_day,start_month) VALUES (?,?,?,?,?,?,?)').run(s.id,s.user_id,s.name,s.amount,s.currency,s.original_day,s.start_month),
    updateSubscription: (uid,id,s) => db.prepare('UPDATE subscriptions SET name=?,amount=?,currency=? WHERE id=? AND user_id=?').run(s.name,s.amount,s.currency,id,uid),
    stopSubscription: (uid,id) => db.prepare('UPDATE subscriptions SET active=0 WHERE id=? AND user_id=?').run(id,uid),
    transactions: (uid,year) => db.prepare('SELECT * FROM transactions WHERE user_id=? AND deleted=0 AND date>=? AND date<=? ORDER BY date DESC,id').all(uid,year+'-01-01',year+'-12-31'),
    transaction: (uid,id) => db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=? AND deleted=0').get(id,uid),
    billingMonths: (uid,id) => db.prepare('SELECT billing_month FROM transactions WHERE subscription_id=? AND user_id=?').all(id,uid),
    createTransaction(t,ignore=false) {
      return db.prepare(`INSERT ${ignore?'OR IGNORE ':''}INTO transactions(id,user_id,type,amount,date,category,memo,subscription_id,billing_month,original_amount,currency,rate,rate_date,payment_method,card_company) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.id,t.user_id,t.type,t.amount,t.date,t.category,t.memo||'',t.subscription_id||null,t.billing_month||null,t.original_amount??null,t.currency||null,t.rate??null,t.rate_date||null,t.payment_method||null,t.payment_method==='card'?t.card_company||null:null);
    },
    updateTransaction: (uid,id,t) => db.prepare('UPDATE transactions SET type=?,amount=?,date=?,category=?,memo=?,payment_method=?,card_company=? WHERE id=? AND user_id=?').run(t.type,t.amount,t.date,t.category,t.memo,t.payment_method||null,t.payment_method==='card'?t.card_company||null:null,id,uid),
    deleteTransaction: (uid,id) => db.prepare('UPDATE transactions SET deleted=1 WHERE id=? AND user_id=?').run(id,uid),
    accountProfiles: () => db.prepare('SELECT id,email,name,role,disabled,created_at FROM users ORDER BY created_at').all(),
    activeUsers: () => db.prepare('SELECT id FROM users WHERE disabled=0').all(),
    async setDisabled(id,disabled) { return !!(await db.prepare("UPDATE users SET disabled=? WHERE id=? AND role!='admin'").run(Number(disabled),id)).changes; },
    close: () => db.close(),
  };
}
