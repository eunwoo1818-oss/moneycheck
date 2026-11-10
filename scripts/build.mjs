import { spawnSync } from 'node:child_process';
if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
  const result = spawnSync(process.execPath,['scripts/migrate.mjs'],{stdio:'inherit',env:process.env});
  if (result.status !== 0) process.exit(result.status || 1);
} else {
  console.log('영구 데이터 저장소 미연결: 화면만 준비되며 로그인 및 기록 기능은 연결 후 사용할 수 있습니다.');
}
console.log('정적 화면 및 API 배포 준비 완료');
