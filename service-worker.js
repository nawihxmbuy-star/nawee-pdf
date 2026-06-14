// 🎯 service-worker.js (ฉบับแก้ไขและเสถียรที่สุด รองรับการทำงานออฟไลน์ 100%)
const CACHE_NAME = 'nawee-pro-studio-v7.8'; // 👈 เวอร์ชัน v5 สำหรับอัปเดตข้อมูลใหม่

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',

  // 📄 ไลบรารีจัดการไฟล์ PDF และส่งออกข้อมูล
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',

  // 🎨 ไลบรารีไอคอนและฟอนต์ภาษาไทย
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800&display=swap'
];

// 1. ทำการติดตั้งแคชข้อมูลเมื่อทำการเปิดตัวแอปครั้งแรก
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting(); // ทำงานทันทีไม่ต้องรอให้ User ปิดแอปก่อน
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
      return self.clients.claim(); // ให้ Service Worker เข้าควบคุมหน้าเว็บทั้งหมดในทันที
    })
  );
});

// 3. ดักจับการเรียกข้อมูล (เปิดโหมดดึงจากแคชก่อนตอนออฟไลน์)
self.addEventListener('fetch', (event) => {
  // 🛑 ป้องกัน Error จาก Chrome Extensions หรือโปรโตคอลอื่นที่ไม่ใช่ http / https
  if (!event.request.url.startsWith('http')) return;

  // ⚡ สำหรับคำขอที่ไม่ใช่ GET (เช่น การยิง POST ไปหา Gemini API) ให้วิ่งตรงไปที่อินเทอร์เน็ตปกติทันที ไม่ต้องดักจับในแคช
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // 🟢 ถ้ามีไฟล์ในแคช (ตอนออฟไลน์) ให้ดึงจากแคชมาใช้ได้เลย ทันที 100%
      if (response) {
        return response;
      }
      
      // 🌐 ถ้าไม่มีในแคช ให้วิ่งไปดึงจากอินเทอร์เน็ตตามปกติ
      // [FIXED] ลบการดักจับ .catch() เปล่าที่คืนค่า undefined ออก เพื่อให้ระบบเน็ตเวิร์กแจ้งเตือนการ Offline ได้ตามปกติโดยไม่เกิดไอคอนเหลืองพังใน Console ค่ะ
      return fetch(event.request);
    })
  );
});
