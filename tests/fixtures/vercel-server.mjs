import http from 'node:http';
import handler from '../../api/index.mjs';
const server = http.createServer(handler);
server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('머니체크 실행'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close(()=>process.exit(0)));
