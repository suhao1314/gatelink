// 接口地址：开发时用本地服务，上线前改为你自己已备案的 HTTPS 域名，并加入小程序 request 合法域名
const USE_DEV_SERVER = false;

const DEV_BASE = 'http://127.0.0.1:8787';
// 改成你自己的域名，必须与后端 PUBLIC_HOST 完全一致
const PROD_BASE = 'https://gate.example.com';

module.exports = {
  API_BASE: USE_DEV_SERVER ? DEV_BASE : PROD_BASE,
  TIMEOUT: 10000,
  STORAGE_TOKEN: 'gl_token',
};
