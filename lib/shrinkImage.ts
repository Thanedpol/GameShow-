/**
 * ย่อภาพประกอบคำถามก่อนส่งข้ามเครื่อง
 *
 * ภาพที่โมเดลวาดมาเป็น PNG data URL ราว 700-900KB ต่อภาพ ซึ่งใหญ่เกินกว่าจะ
 * ยัดขึ้นห้องได้ (Upstash รับคำขอได้ราว 1MB และเราต้องเผื่อที่ให้ข้อมูลอื่นด้วย)
 * ย่อเป็น JPEG กว้าง 900px แล้วเหลือราวหนึ่งในสิบ โดยยังอ่านตัวเลขในตารางออก
 * ซึ่งเป็นสิ่งเดียวที่โจทย์ "หาจุดผิดในภาพ" ต้องการ
 *
 * ผลลัพธ์แคชไว้ตาม data URL ต้นทาง เพราะสถานะสดถูกส่งซ้ำหลายครั้งต่อข้อ
 * (ทุกครั้งที่เปิดกล่องหรือเปลี่ยนช่วง) จะได้ไม่ต้องเข้ารหัสใหม่ทุกรอบ
 */

const MAX_WIDTH = 900;
const QUALITY = 0.72;

const cache = new Map<string, string>();

export function shrinkImage(dataUrl: string): Promise<string> {
  const hit = cache.get(dataUrl);
  if (hit) return Promise.resolve(hit);

  return new Promise((resolve) => {
    // ล้มเหลวเมื่อไหร่ก็คืนของเดิม ปล่อยให้ชั้นที่เรียกตัดสินใจต่อ
    // ดีกว่าโยน error ใส่การซิงก์สถานะเกมซึ่งต้องไม่พังเพราะเรื่องภาพ
    const fail = () => resolve(dataUrl);
    const img = new Image();
    img.onerror = fail;
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_WIDTH / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return fail();
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL("image/jpeg", QUALITY);
        // ย่อแล้วใหญ่กว่าเดิมก็ใช้ของเดิม (เกิดได้กับภาพเล็กที่เป็น PNG อยู่แล้ว)
        const best = out.length < dataUrl.length ? out : dataUrl;
        cache.set(dataUrl, best);
        resolve(best);
      } catch {
        fail();
      }
    };
    img.src = dataUrl;
  });
}
