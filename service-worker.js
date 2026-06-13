// 🎯 [UPDATED] ขยับเวอร์ชันจาก v3 เป็น v4 เพื่อบังคับให้บราวเซอร์โหลดไฟล์ index.html และ script.js ใบใหม่ที่เราเพิ่งแก้ไป
const CACHE_NAME = 'nawee-pro-studio-v4'; 
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// 1. ทำการติดตั้งแคชข้อมูลเมื่อทำการเปิดตัวแอปครั้งแรก
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      // 🎯 สั่งให้ Service Worker ตัวใหม่ข้ามการรอคอย และทำงานทันทีเมื่อมีการอัปเดตโค้ด
      return self.skipWaiting();
    })
  );
});

// 2. ระบบล้างแคชเวอร์ชันเก่าทิ้งเมื่อเปิดใช้งานเวอร์ชันใหม่ (ป้องกันพื้นที่มือถือผู้ใช้เต็ม)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('ระบบกำลังเคลียร์ไฟล์แคชเวอร์ชันเก่าออก:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      // ให้ Service Worker ตัวใหม่เข้าควบคุมหน้าเว็บทั้งหมดในทันทีโดยไม่ต้องรอรีเฟรช
      return self.clients.claim();
    })
  );
});

// 3. เรียกคืนข้อมูลจากแคชอัตโนมัติหากไม่มีสัญญาณอินเทอร์เน็ต (Cache-First Strategy)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
