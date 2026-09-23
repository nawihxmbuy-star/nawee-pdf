// 🎯 service-worker.js (v17.0 - Nawee PDF Vector Studio & Offline Engine)
const CACHE_NAME = 'nawee-pdf-pro-v17.0';

// ไฟล์หลักของโปรเจกต์ภายในเครื่อง
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ไลบรารีภายนอกที่จำเป็นสำหรับระบบ Vector PDF และ Fontkit
const EXTERNAL_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://unpkg.com/@pdf-lib/fontkit@0.0.4/dist/fontkit.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// 1. ทำการติดตั้งแคชเมื่อโหลดเวอร์ชันใหม่
self.addEventListener('install', (event) => {
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
    }).then(() => self.skipWaiting())
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

// 3. ดักจับ Request แบบ Cache-First และ Dynamic Cache ออฟไลน์
self.addEventListener('fetch', (event) => {
  // กรองเฉพาะคำขอผ่านโปรโตคอล http / https
  if (!event.request.url.startsWith('http')) return;

  // สำหรับคำขอที่ไม่ใช่ GET (เช่น ส่งคำสั่งหา Gemini API) ให้ปล่อยผ่านไปยังอินเทอร์เน็ตตรงๆ
  if (event.request.method !== 'GET') {
    return;
  }

  // ไม่แคชการยิงไปยัง Google Generative Language API
  if (event.request.url.includes('generativelanguage.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // หากดาวน์โหลดไฟล์สำเร็จ (รวมถึงฟอนต์ Sarabun) ให้เก็บสำรองเข้าแคชไว้ใช้งานออฟไลน์
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
