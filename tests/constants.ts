import path from 'path';

// 設定ファイルからもテストコードからも参照できる純粋な定数
export const STORAGE_STATE = path.join(process.cwd(), '.auth/user.json');