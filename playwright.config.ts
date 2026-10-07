import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'*.spec.ts',fullyParallel:true,
 use:{baseURL:'http://127.0.0.1:5173',headless:true},
 projects:[
  {name:'chromium',use:{browserName:'chromium',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH,args:['--no-sandbox']}}},
  {name:'mobile-webkit',use:{browserName:'webkit',viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-TW',timezoneId:'Asia/Taipei'}}
 ],
 webServer:{command:'npm run dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
 reporter:'list'
});
