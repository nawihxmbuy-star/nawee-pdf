// 🎯 service-worker.js (v18.0 - Sunita PDF Studio & Offline Engine)
const CACHE_NAME = 'sunita-pdf-v18.0';

// ไฟล์หลักของโปรเจกต์ภายในเครื่อง (เพิ่ม cat-avatar.png เรียบร้อย)
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './cat-avatar.png'
];

// ไลบรารีภายนอกที่จำเป็นสำหรับระบบ Vector PDF และ Fontkit
const EXTERNAL_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://unpkg.com/@pdf-lib/fontkit@0.0.4/dist/fontkit.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// 1. ทำการติดตั้งแคชและบังคับ Skip Waiting ทันที
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // แคช Core Assets ให้สำเร็จแน่นอนเป็นอันดับแรก
      await cache.addAll(CORE_ASSETS);

      // แคช CDN ภายนอกแบบแยกจับข้อผิดพลาด ป้องกันการล้มเหลวทั้งชุดหากเน็ตช้า
      try {
        await cache.addAll(EXTERNAL_LIBS);
      } catch (err) {
        console.warn('บาง CDN ภายนอกแคชไม่สำเร็จขณะติดตั้ง:', err);
      }
    })
  );
});

// 2. เคลียร์แคชเวอร์ชันเก่าทิ้งทันทีเมื่อเปิดใช้งาน
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('ลบแคชเวอร์ชันเก่าออกแล้ว:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. ดักจับ Request แบบ Network-First สำหรับไฟล์ในเครื่องเพื่อป้องกันแคชค้าง
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.url.includes('generativelanguage.googleapis.com')) {
    return;
  }

  event.respondWith(
    // ดึงจากเน็ตก่อนเพื่อให้ได้เวอร์ชันล่าสุดเสมอ ถ้าไม่มีเน็ตจะดึงจาก Cache ให้
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
