import "server-only";

import { SHARED_RULES } from "./hintEngine";
import {
  callLlmJson,
  isChoiceReady,
  resolveLlm,
  type LlmChoice,
  type LlmChoiceInput,
} from "./llm";
import { drawPerformanceTasks, drawSeeds, type QuestionSeed } from "./questionSeeds";
import { harvest, verifyLinks, type FeedGroup, type NewsItem } from "./sources";
import {
  HINT_ZONES,
  type Category,
  type Difficulty,
  type HintZone,
  type Question,
  type QuestionFormat,
  type Stage,
} from "./types";

/**
 * ตัวแต่งคำถามสดจากข่าวจริง
 *
 * ทำไมไม่ปล่อยให้โมเดลนึกคำถามเอาเอง: โมเดลจะวนอยู่กับความรู้ยอดนิยมในหัวมันเอง
 * ถามซ้ำเรื่องเดิม ๆ และไม่มีทางรู้ว่าอะไรเพิ่งเกิดขึ้น การป้อนข่าวจริงเข้าไป
 * ทำให้คำถามเปลี่ยนตามโลกจริงทุกวันโดยไม่ต้องแก้โค้ด
 *
 * ทำไมยังต้องมีตัวตรวจฝั่งเรา: โมเดลแต่งเฉลยผิดได้ ปรนัยที่เฉลยผิดคือของเสีย
 * ที่ผู้เล่นจับได้ทันที ทุกข้อจึงต้องผ่าน validateQuestion() ก่อนถึงมือผู้เล่น
 */

const CATEGORIES: Category[] = [
  "สแกม",
  "การเงิน",
  "AI",
  "สุขภาพ",
  "ที่ทำงาน",
  "ชีวิตจริง",
  "สื่อสาร",
  "ตรรกะ",
];

const DIFFICULTIES: Difficulty[] = ["ง่าย", "กลาง", "ยาก"];

// ────────────────────────────────────────────────────────────────────────────
// Prompt
// ────────────────────────────────────────────────────────────────────────────

const SYSTEM = `
คุณคือคนเขียนคำถามของเกมโชว์ไทย "ใบ้จริง...ใบ้หลอก"

หน้าที่: แต่งคำถามใหม่จากข่าว/บทความจริงที่ได้รับมา พร้อมคำใบ้จริงและคำใบ้หลอกของแต่ละข้อ

หัวใจของคำถามที่ดีในเกมนี้:
- ต้องพาผู้เล่นไปเจอ "ปัญหาชีวิตจริงหรือโลกการทำงาน" ที่เอาไปใช้ต่อได้จริง
  ไม่ใช่คำถามความจำแบบท่องจำว่าใครทำอะไรที่ไหนเมื่อไหร่
- ผู้เล่นที่ไม่เคยอ่านข่าวชิ้นนั้นก็ต้องตอบได้ ถ้าคิดเป็น — ข่าวเป็นแค่ "ที่มา"
  ของประเด็น ไม่ใช่ตัวข้อสอบวัดว่าอ่านข่าวหรือยัง
- ห้ามถามเรื่องที่ต้องรู้ชื่อบริษัท ตัวเลข หรือวันที่เฉพาะจากข่าวชิ้นนั้น

⚠️ หัวข้อต้องกระจาย ห้ามกองอยู่ที่เรื่องงาน:
- เรื่องที่ทำงาน (ประชุม ฟีดแบ็ก เจ้านาย เพื่อนร่วมงาน) ให้มีได้ไม่เกิน 1 ใน 4 ของชุด
  ผู้เล่นบอกว่าที่ผ่านมาเจอแต่เรื่องงานจนน่าเบื่อ
- ที่เหลือให้สลับไปหมวดอื่นให้หลากหลาย เช่น ข่าว AI · เศรษฐกิจที่จับต้องได้
  (เงินเฟ้อ ค่าครองชีพ ดอกเบี้ย ราคาของ) · ประวัติศาสตร์ที่โยงมาถึงวันนี้ ·
  วิทยาศาสตร์และคณิตศาสตร์ใกล้ตัว · สุขภาพ · ชีวิตประจำวัน
- ⚠️ วิทย์-คณิต ห้ามถามแบบท่องสูตร ห้ามให้แทนค่าในสมการที่ต้องจำมาก่อน
  ให้ถามแบบที่คนทั่วไปใช้เหตุผลตามได้ เช่น อ่านกราฟแล้วบอกว่ามันหลอกตรงไหน
  เทียบขนาดสองอย่างให้เห็นภาพ หรือประเมินว่าอะไรน่าจะเกิดบ่อยกว่ากันเพราะอะไร
- ประวัติศาสตร์ให้เน้น "แล้วมันเกี่ยวอะไรกับวันนี้" ไม่ใช่ถามปี พ.ศ. หรือชื่อคน

⚠️ ระดับความยากต้องคละ ไม่ใช่ยากหมดทั้งชุด:
- ในทุกชุด ให้มีข้อที่ "อ่านแล้วเข้าใจทันที ตอบได้ด้วยการคิดสั้น ๆ" ปนอยู่ด้วย
  ประมาณ 1 ใน 3 — ผู้เล่นบอกว่าบางข้อยากเกินจนหมดสนุก
- ข้อง่ายไม่ได้แปลว่าไม่ต้องคิด แต่แปลว่า "คิดชั้นเดียวก็พอ" และภาษาต้องตรงไปตรงมา
  ไม่มีศัพท์เฉพาะทางที่ต้องรู้มาก่อน
- ข้อง่ายก็ยังต้องฝึกการคิด เช่น แยกเหตุออกจากผล จับจุดที่ขัดกันเอง
  หรือมองว่าถ้าทำแบบนี้แล้วจะกระทบอะไรต่อ (คิดเชิงระบบ)

⚠️ โจทย์ที่ยาก ต้องคิดหลายชั้น:
- คำถามที่ดีต้องผ่าน "อย่างน้อย 2 ชั้นความคิด" กว่าจะได้คำตอบ เช่น
    ชั้นที่ 1 อ่านข้อมูลที่ให้มาแล้วรู้ว่าต้องดูตัวไหน
    ชั้นที่ 2 เอาหลักการมาใช้กับตัวนั้น แล้วถึงได้คำตอบ
  ตัวอย่างที่ผ่าน: "ตัวเลขไหนขัดกันเอง และถ้าคำนวณใหม่ควรเป็นเท่าไร"
    (ต้องหาจุดผิด → แล้วต้องคำนวณค่าที่ถูกด้วย)
  ตัวอย่างที่ตก: "ข้อใดคือความหมายของ X" (เปิดพจนานุกรมก็ตอบได้ ไม่ต้องคิด)
- ห้ามให้คำตอบที่ถูกเป็นข้อที่ "เดาได้จากสามัญสำนึกโดยไม่ต้องใช้ข้อมูลในโจทย์"
  ลองทดสอบเอง: ถ้าลบข้อมูลในโจทย์ทิ้งแล้วยังเดาถูก แปลว่าคำถามยังไม่ดีพอ ให้แต่งใหม่
- ตัวลวงในปรนัยต้องเป็น "คำตอบของคนที่คิดถูกครึ่งทาง" เช่น คำนวณถูกแต่ลืมแปลงหน่วย
  หรือจับจุดผิดเจอแต่แก้ผิดวิธี — ไม่ใช่ตัวเลือกที่ผิดจนไม่มีใครเลือก

ข้อห้ามเรื่องแหล่งที่มา (สำคัญ):
- ห้ามคัดลอกข้อความจากข่าวมาตรง ๆ ให้เขียนขึ้นใหม่ด้วยคำของตัวเองเสมอ
- ถ้าโจทย์ให้ "อ่านออกเสียง" ต้องเขียนย่อหน้านั้นขึ้นใหม่เอง ห้ามวางเนื้อข่าวต้นฉบับ
- ห้ามเอ่ยชื่อบุคคลจริงในลักษณะที่ทำให้เข้าใจผิดเกี่ยวกับตัวเขา

ข้อห้ามเรื่องเนื้อหา:
- ห้ามแตะเรื่องความรุนแรง ความตาย ภัยพิบัติ คดีความ การเมือง ศาสนา หรือความขัดแย้งระหว่างประเทศ
  ถ้าข่าวชิ้นไหนเป็นแนวนั้น ให้ข้ามไปใช้ชิ้นอื่น
- ห้ามให้คำแนะนำทางการแพทย์ กฎหมาย หรือการเงินที่เฉพาะเจาะจงจนคนเอาไปทำตามแล้วเสียหาย

รูปแบบคำถามมี 3 แบบ:
  choice      = ปรนัย 4 ตัวเลือก มีคำตอบถูก 1 ข้อ
  open        = อัตนัย ผู้เล่นพิมพ์ตอบเป็นข้อความ แล้วมีคนตรวจตาม rubric
  performance = โชว์ความสามารถสด ๆ บนเวที (พูด เล่า ร้อง พิตช์) แล้วพิมพ์สรุปสิ่งที่ทำให้ AI ตรวจตาม rubric

กติกาของแต่ละแบบ:
- choice: ตัวเลือกทั้ง 4 ต้องดูน่าเชื่อพอกัน ความยาวใกล้เคียงกัน ห้ามมีข้อไหนยาวผิดปกติ
  หรือใช้คำอย่าง "ทั้งหมดที่กล่าวมา" ที่เดาได้ทันที · correctAnswer ต้องตรงกับข้อความ
  ในตัวเลือกข้อหนึ่งแบบเป๊ะทุกตัวอักษร
- open: ต้องมี rubric บอกว่ากรรมการดูอะไร และ keyPoints 2-4 ข้อที่คำตอบดีควรมี
- performance: ต้องมี task บอกชัดว่าผู้เล่นต้องทำอะไรบนเวทีภายในเวลาที่กำหนด และมี rubric

โจทย์ "หาจุดผิดจากภาพ" (บางข้อเท่านั้น ตามที่บรีฟกำหนด):
- ใส่ imagePrompt = คำอธิบายภาพที่จะวาด บอกข้อความไทยทุกบรรทัดที่ต้องมีในภาพ
  แล้วระบุให้ชัดว่าจุดผิดคืออะไรและอยู่ตรงไหน
- ตัวคำถาม (prompt) ต้องอ่านรู้เรื่องแม้ยังไม่เห็นภาพ เช่น
  "ดูงบรายเดือนนี้แล้วบอกว่าตัวเลขบรรทัดไหนไม่สมเหตุสมผล และควรเป็นเท่าไร"
- ใส่ errorZone บอกว่าจุดผิดอยู่โซนไหนของภาพ (บนซ้าย/บนกลาง/.../ล่างขวา)
- ชนิดของ "จุดผิด" ที่ใช้ได้: ตัวเลขที่บวกไม่ตรง สัดส่วนที่ขัดกับข้อมูล
  ลำดับขั้นตอนที่สลับกัน หน่วยที่ผิด กราฟที่แกนบิดเบือน ข้อความที่ขัดแย้งกันเอง
- ⚠️ จุดผิดต้องเนียน ไม่ใช่โจ่งแจ้ง (ผู้เล่นบอกว่าของเดิมมองออกง่ายเกินไป):
    ใช้ได้   → ตัวเลขที่ดูสมเหตุสมผลแต่รวมแล้วไม่ตรง · หน่วยที่ผิดแค่จุดเดียวในตาราง
              ที่หน่วยอื่นถูกหมด · เปอร์เซ็นต์ที่รวมได้ 103% · แกนกราฟที่ไม่เริ่มจากศูนย์
    ห้ามใช้  → ตัวเลขที่ผิดจนดูออกตั้งแต่แวบแรก เช่น อายุ 500 ปี ราคา 1 ล้านบาทสำหรับกาแฟ
              หรือจุดผิดที่ถูกไฮไลต์/ทำสีต่างจากที่อื่นในภาพ
- ภาพต้องมีข้อมูลมากพอให้ต้อง "ไล่ตรวจ" ไม่ใช่มีแค่ 2-3 บรรทัดแล้วเห็นจุดผิดทันที
  ตารางควรมีอย่างน้อย 5-6 แถว และตัวเลขที่ถูกต้องรอบ ๆ ต้องสมจริงทั้งหมด
- ⚠️ ห้ามสั่งวาดของปลอมที่เลียนแบบของจริง เช่น หน้าจอ SMS ธนาคาร อีเมลฟิชชิง
  ใบเสร็จปลอม หรือเอกสารราชการ — โมเดลวาดภาพจะปฏิเสธ และของแบบนั้นเอาไปใช้
  หลอกคนจริงได้ ให้ใช้ "ของที่ผิดโดยไม่ใช่ของปลอม" เช่น ตาราง กราฟ ป้ายประกาศ
  อินโฟกราฟิก แทน
- ข้อที่ไม่ใช่แนวนี้ ให้ส่ง imagePrompt และ errorZone เป็นค่าว่าง

เฉลย (explanation) — ผู้เล่นเห็นตอนจบข้อ และเป็นจุดที่ข้อมูลผิดจะสร้างความเสียหายที่สุด:
- เขียนให้คนทั่วไปอ่านแล้วเห็นภาพและไล่ตามเองได้ ไม่ใช่ต้องเชื่อเพราะเกมบอก
- ⚠️ ห้ามพูดถึงกลไกเบื้องหลังของเกมในเฉลย เช่น "ข้อนี้ต้องคิด 2 ชั้น"
  "ชั้นแรกคือ... ชั้นที่สองคือ..." หรืออ้างถึงระดับความยาก/ตัวลวง
  พวกนั้นเป็นคำสั่งสำหรับคนแต่งข้อสอบ ไม่ใช่สิ่งที่ผู้เล่นควรเห็น
  ผู้เล่นอยากรู้ว่า "คำตอบคืออะไรและทำไม" ให้เล่าเป็นเหตุผลตรง ๆ เลย
- ⚠️ ข้อที่ต้องคำนวณ ให้กางวิธีคิดทีละขั้นเสมอ ตามลำดับนี้:
    1) ยกตัวเลขตั้งต้นจากโจทย์มาวางให้ครบ พร้อมหน่วย
       เช่น "ฉลากระบุ โปรตีน 20 ก. · คาร์โบไฮเดรต 15 ก. · ไขมัน 5 ก."
    2) แสดงการคำนวณทีละบรรทัด ให้เห็นว่าเลขไหนคูณอะไร
       เช่น "โปรตีน 20 × 4 = 80 kcal · คาร์บ 15 × 4 = 60 kcal · ไขมัน 5 × 9 = 45 kcal"
    3) สรุปผลรวม แล้วเทียบกับตัวเลขในโจทย์ว่าต่างกันตรงไหน
       เช่น "รวม 80 + 60 + 45 = 185 kcal แต่ฉลากเขียน 450 kcal จึงขัดกันเอง"
  ห้ามบอกแค่ผลลัพธ์สุดท้ายลอย ๆ โดยไม่โชว์ที่มา
  และห้ามอธิบายแค่หลักการกว้าง ๆ โดยไม่แทนตัวเลขจริงลงไป
- ตัวเลขทุกตัวต้องตรงกับที่อยู่ในโจทย์/ภาพเป๊ะ และต้องคำนวณถูกจริง
  คิดเลขซ้ำอีกรอบก่อนส่ง — เฉลยที่คำนวณผิดเสียหายกว่าไม่มีเฉลย
- แยกตัวเลขสองชนิดนี้ให้ออก อย่าเหมารวม:
    ตัวเลขที่ "โจทย์ให้มาเอง" (บนฉลาก ในตาราง ในภาพ) → ต้องเอามากางและคำนวณให้เห็น
      เพราะผู้เล่นตรวจสอบได้ในตัว ไม่ใช่ความเสี่ยงว่าจะมั่ว
    ตัวเลขที่ "ต้องไปรู้จากข้างนอก" (สถิติ ปี ชื่อองค์กร ชื่องานวิจัย)
      → ห้ามอ้างถ้าไม่ได้อยู่ในข่าวที่ให้มา ให้เลี่ยงไปอธิบายด้วยหลักการแทน
- ถ้าเรื่องนั้นมีข้อถกเถียงหรือขึ้นกับบริบท ให้บอกตรง ๆ ว่าขึ้นกับอะไร
  อย่าฟันธงเป็นข้อเท็จจริงเดียว

แหล่งอ้างอิง (sourceIndex + sourceNote) — ผู้เล่นจะกดไปตรวจว่าเฉลยเชื่อถือได้ไหม:
- sourceIndex = หมายเลข [n] ของข่าวที่ข้อนั้น "อิงเนื้อหาจริง ๆ"
- ถ้าข้อนั้นคิดขึ้นจากหลักการทั่วไป ไม่ได้อิงข่าวชิ้นไหนเป็นพิเศษ ให้ใส่ 0
  ⚠️ ไม่มีแหล่งอ้างอิง ดีกว่าแปะแหล่งที่ไม่ตรงกับเนื้อหา — การแปะมั่วทำลายความน่าเชื่อถือ
  ของทั้งเกม เพราะผู้เล่นกดเข้าไปแล้วเจอเรื่องคนละเรื่อง จะไม่เชื่อเฉลยข้ออื่นอีกเลย
- sourceNote = อธิบายสั้น ๆ ว่าข่าวชิ้นนั้นให้อะไรกับข้อนี้ (เช่น "ข่าวนี้พูดถึงการอ่าน
  ฉลากโภชนาการข้ามประเทศ") ถ้าเขียนไม่ออกว่ามันเกี่ยวกันตรงไหน แปลว่าไม่เกี่ยว → ใส่ 0
- ห้ามพิมพ์ URL เอง ระบบจะหยิบลิงก์จากหมายเลขที่ระบุให้เอง

คำใบ้ของทุกข้อ (ต้องมีครบทั้ง real 3 และ fake 3):
  real = เบาะแสที่ถูกต้อง 100% ชี้ทางด้วยหลักการของหมวดนั้น แต่ไม่เฉลย
  fake = ประโยคเดียวสองท่อน ท่อนแรกเป็นข้อเท็จจริงที่ถูกจริง ท่อนหลังฟังดูน่าเชื่อแต่ผิด
         และชี้ไปยังคำตอบที่ผิด · ห้ามอ้างแหล่งข้อมูลปลอมที่ไม่มีอยู่จริง
         ห้ามแต่งข้อมูลเท็จเรื่องยา การรักษา ขั้นตอนทางกฎหมาย หรือการโอนเงิน/ลงทุน

ทำให้คำใบ้หลอกเนียนขึ้น (ผู้เล่นบอกว่าของเดิมมองออกง่ายเกินไป):
- ห้ามให้ "ความยาว น้ำเสียง หรือความมั่นใจ" ต่างจากคำใบ้จริงจนแยกออกด้วยสายตา
  ถ้าคำใบ้จริงสุภาพและระบุเงื่อนไข คำใบ้หลอกก็ต้องสุภาพและระบุเงื่อนไขเหมือนกัน
- ห้ามใช้คำที่ส่งกลิ่นว่ากำลังหลอก เช่น "เสมอ" "ทุกกรณี" "ห้ามเด็ดขาด" "100%"
  ของจริงในโลกจริงมักมีเงื่อนไข คำใบ้หลอกที่ฟันธงเกินไปคือธงแดงที่มองเห็นแต่ไกล
- จุดที่ผิดต้องเป็น "รายละเอียดที่ต้องรู้จริงถึงจะจับได้" เช่น สลับตัวคูณ ใช้หน่วยผิด
  สลับเหตุกับผล หรือเอากฎที่ถูกไปใช้ผิดบริบท — ไม่ใช่ผิดแบบที่สามัญสำนึกจับได้ทันที
- ท่อนแรกที่เป็นเรื่องจริงต้องจริงและตรวจสอบได้จริง ยิ่งท่อนแรกแน่น ท่อนหลังยิ่งพาหลงได้

${SHARED_RULES}
`.trim();

/**
 * ความยากไต่ขึ้นเองตามช่วง ไม่ให้ผู้เล่นเลือกระดับ
 *
 * เขียนเป็น "จำนวนชั้นความคิด" กับ "ความเนียนของตัวลวง" แทนคำว่า ง่าย/กลาง/ยาก
 * เพราะของเดิมบอกแค่ระดับลอย ๆ แล้วโมเดลตีความเองว่าแค่ไหนถึงเรียกยาก
 * ผลคือทั้งสามช่วงออกมาใกล้เคียงกันหมด — ผู้เล่นถึงบอกว่าง่ายไปทั้งเกม
 */
const STAGE_BRIEF: Record<Stage, string> = {
  warmup: [
    "ช่วงวอร์มอัพ — ให้เข้าถึงง่าย อ่านแล้วเข้าใจโจทย์ทันที ไม่ต้องรู้ศัพท์เฉพาะ",
    "คิดชั้นเดียวถึงสองชั้นก็ตอบได้ แต่ยังต้องคิด ไม่ใช่ท่องจำมาตอบ",
    "ตัวลวงเป็นความเข้าใจผิดที่พบบ่อยจริง ๆ · ถ้ามีคำนวณ ให้เป็นขั้นตอนเดียวจบ",
    "ระดับ: ง่าย ถึง กลาง — ช่วงนี้มีไว้ให้ผู้เล่นได้คะแนนและเริ่มสนุก",
  ].join("\n  "),
  push: [
    "ช่วงกลางเกม — ต้องคิด 2-3 ชั้น มีกับดักที่คนคิดเร็วจะตกจริง ๆ",
    "ตัวลวงต้องเป็นคำตอบของคนที่คิดถูกครึ่งทาง เช่น คำนวณถูกแต่ลืมแปลงหน่วย",
    "ถ้ามีคำนวณ ให้มี 2 ขั้นขึ้นไป หรือต้องเปรียบเทียบสองชุดข้อมูล",
    "ระดับ: กลาง ถึง ยาก",
  ].join("\n  "),
  final: [
    "ช่วงชิงชนะเลิศ — ต้องคิด 3 ชั้นขึ้นไป และต้องชั่งน้ำหนักหลายปัจจัยพร้อมกัน",
    "โจทย์ควรมีข้อมูลที่ดูขัดกันเอง ผู้เล่นต้องตัดสินว่าอันไหนเชื่อได้และเพราะอะไร",
    "ตัวลวงต้องเนียนถึงขั้นที่คนรู้เรื่องนั้นครึ่งเดียวจะเลือกผิด",
    "ระดับ: ยาก — แต่ต้องยากเพราะซับซ้อน ไม่ใช่ยากเพราะกำกวมหรือข้อมูลไม่พอ",
  ].join("\n  "),
};

function newsBlock(items: NewsItem[]): string {
  return items
    .map(
      (n, i) =>
        `[${i + 1}] (${n.source} · ${n.region}) ${n.title}` +
        (n.summary ? `\n    ${n.summary}` : "") +
        `\n    ลิงก์: ${n.link}`,
    )
    .join("\n");
}

function seedBlock(seeds: QuestionSeed[], tasks: string[]): string {
  const lines = seeds.map(
    (s, i) => `[${i + 1}] เรื่อง: ${s.domain} · มุม: ${s.angle} · ทักษะที่อยากให้ได้: ${s.skill}`,
  );
  if (tasks.length > 0) {
    lines.push("", "แม่แบบโจทย์โชว์ความสามารถ (เลือกไปดัดแปลงให้เข้ากับเรื่องที่ได้):");
    lines.push(...tasks.map((t) => `- ${t}`));
  }
  return lines.join("\n");
}

interface BuildPromptArgs {
  stage: Stage;
  count: number;
  formatPlan: QuestionFormat[];
  seeds: QuestionSeed[];
  tasks: string[];
  news: NewsItem[];
  avoid: string[];
  imageCount: number;
}

function buildPrompt(args: BuildPromptArgs): string {
  const formatCount = args.formatPlan.reduce<Record<string, number>>((acc, f) => {
    acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    `ช่วงของเกม: ${args.stage} — ${STAGE_BRIEF[args.stage]}`,
    `จำนวนที่ต้องแต่ง: ${args.count} ข้อ`,
    "",
    `ในชุดนี้ให้เป็นโจทย์ "หาจุดผิดจากภาพ" ${args.imageCount} ข้อ (ใส่ imagePrompt กับ errorZone) ที่เหลือเป็นคำถามข้อความธรรมดา`,
    "",
    "สัดส่วนรูปแบบที่ต้องได้ (ห้ามเกินห้ามขาด):",
    ...Object.entries(formatCount).map(([f, n]) => `- ${f}: ${n} ข้อ`),
    "",
    "ข่าวและบทความจริงที่เพิ่งเผยแพร่ — ใช้เป็นวัตถุดิบ เลือกชิ้นที่เหมาะ ไม่ต้องใช้ครบทุกชิ้น:",
    newsBlock(args.news),
    "",
    `บรีฟรายข้อ — ข้อที่ ${args.count} ข้อต้องกระจายตามนี้ ห้ามกองอยู่เรื่องเดียว:`,
    seedBlock(args.seeds, args.tasks),
    "",
    "ถ้ามีข่าวชิ้นไหนในรายการเข้ากับโจทย์ตั้งต้นข้อใดได้พอดี ให้ดึงประเด็นจากข่าวชิ้นนั้น",
    "มาทำโจทย์ แล้วใส่ sourceIndex ของมัน · ถ้าไม่มีชิ้นไหนเข้ากันจริง ๆ ให้แต่งจาก",
    "โจทย์ตั้งต้นอย่างเดียวแล้วใส่ 0 — อย่าฝืนจับคู่ข่าวที่ไม่เกี่ยวเพื่อให้มีแหล่งอ้างอิง",
  ];

  if (args.avoid.length > 0) {
    lines.push(
      "",
      "คำถามที่ผู้เล่นคนนี้เพิ่งเจอไปแล้ว — ห้ามถามซ้ำหรือถามใกล้เคียง:",
      ...args.avoid.map((t) => `- ${t}`),
    );
  }

  lines.push(
    "",
    `แต่งมา ${args.count} ข้อ ตอบเป็น JSON ตามสคีมา`,
    "ฟิลด์ที่ไม่เกี่ยวกับรูปแบบนั้นให้ส่งค่าว่าง — choices เป็น [] · correctAnswer/task/rubric เป็น \"\"",
    "",
    "⚠️ แหล่งอ้างอิงของแต่ละข้อ:",
    `- sourceIndex = หมายเลข [n] ของข่าวที่ข้อนั้นอิงเนื้อหาจริง ๆ (1-${args.news.length})`,
    "- ถ้าข้อนั้นไม่ได้อิงข่าวชิ้นไหนเป็นพิเศษ ให้ใส่ 0 — ไม่มีแหล่งดีกว่าแปะมั่ว",
    "- sourceNote = บอกสั้น ๆ ว่าข่าวชิ้นนั้นเกี่ยวกับข้อนี้ตรงไหน",
    "  ถ้าเขียนไม่ออกว่าเกี่ยวกันยังไง แปลว่าไม่เกี่ยว → ใส่ sourceIndex เป็น 0",
    "- ห้ามพิมพ์ URL เอง ระบบหยิบลิงก์จากหมายเลขให้เอง",
  );
  return lines.join("\n");
}

/**
 * ทุกฟิลด์เป็น required หมด แล้วให้ส่งค่าว่างสำหรับฟิลด์ที่ไม่เกี่ยวกับรูปแบบนั้น
 *
 * เพราะโหมด strict ของ OpenAI/Gemini บังคับว่าทุก property ต้องอยู่ใน required
 * ถ้าประกาศเป็น optional สคีมาจะถูกปฏิเสธ การใช้ค่าว่างจึงเป็นทางที่ทำงานได้ทุกค่าย
 */
const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["choice", "open", "performance"] },
          category: { type: "string", enum: CATEGORIES },
          difficulty: { type: "string", enum: DIFFICULTIES },
          prompt: { type: "string", description: "ตัวคำถาม ภาษาไทย 1-3 ประโยค" },
          choices: {
            type: "array",
            description: "ปรนัย: 4 ตัวเลือก · รูปแบบอื่น: []",
            items: { type: "string" },
          },
          correctAnswer: {
            type: "string",
            description: "ปรนัย: ต้องตรงกับตัวเลือกข้อหนึ่งเป๊ะ ๆ · รูปแบบอื่น: \"\"",
          },
          rubric: { type: "string", description: "อัตนัย/โชว์: เกณฑ์ให้คะแนน · ปรนัย: \"\"" },
          keyPoints: {
            type: "array",
            description: "อัตนัย: ประเด็นที่คำตอบดีควรมี 2-4 ข้อ · อื่น ๆ: []",
            items: { type: "string" },
          },
          task: { type: "string", description: "โชว์: สิ่งที่ต้องทำบนเวที · อื่น ๆ: \"\"" },
          explanation: {
            type: "string",
            description:
              "เฉลย + เหตุผล เขียนให้คนทั่วไปไล่ตามได้ · ข้อที่ต้องคำนวณ ต้องกาง" +
              "ตัวเลขตั้งต้น การคำนวณทีละบรรทัด และผลรวมที่เทียบกับโจทย์ ห้ามบอกแต่ผลลัพธ์",
          },
          hints: {
            type: "object",
            properties: {
              real: { type: "array", items: { type: "string" } },
              fake: { type: "array", items: { type: "string" } },
            },
            required: ["real", "fake"],
            additionalProperties: false,
          },
          sourceNote: {
            type: "string",
            description:
              "ข่าวชิ้นที่อ้างอิงเกี่ยวกับข้อนี้ตรงไหน · ไม่ได้อิงข่าวชิ้นไหน: \"\"",
          },
          sourceIndex: {
            type: "integer",
            description:
              "หมายเลข [n] ของข่าวที่ข้อนี้อิงเนื้อหาจริง ๆ · ไม่ได้อิงข่าวชิ้นไหน: 0 " +
              "· ห้ามส่ง URL ระบบหยิบลิงก์จากหมายเลขให้เอง",
          },
          imagePrompt: {
            type: "string",
            description:
              "ข้อที่ให้หาจุดผิดจากภาพ: คำอธิบายภาพที่จะวาด ระบุข้อความไทยทุกบรรทัด " +
              "และบอกให้ชัดว่าจุดผิดอยู่ตรงไหน · ข้ออื่น ๆ: \"\"",
          },
          errorZone: {
            type: "string",
            description:
              "ข้อที่มีภาพ: จุดผิดอยู่โซนไหนของภาพ (แบ่ง 3x3) · ข้ออื่น ๆ: \"\"",
            enum: [...HINT_ZONES, ""],
          },
        },
        required: [
          "format",
          "category",
          "difficulty",
          "prompt",
          "choices",
          "correctAnswer",
          "rubric",
          "keyPoints",
          "task",
          "explanation",
          "hints",
          "sourceNote",
          "sourceIndex",
          "imagePrompt",
          "errorZone",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

interface RawQuestion {
  format?: string;
  category?: string;
  difficulty?: string;
  prompt?: string;
  choices?: string[];
  correctAnswer?: string;
  rubric?: string;
  keyPoints?: string[];
  task?: string;
  explanation?: string;
  hints?: { real?: string[]; fake?: string[] };
  sourceNote?: string;
  sourceIndex?: number;
  imagePrompt?: string;
  errorZone?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// ตัวตรวจ
// ────────────────────────────────────────────────────────────────────────────

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(clean).filter((s) => s.length > 0) : [];

/**
 * ทิ้งข้อที่ใช้ไม่ได้ทิ้งไปเลย ดีกว่าพยายามซ่อม
 *
 * ข้อที่เฉลยผิดหรือคำใบ้ไม่ครบทำลายเกมมากกว่าการมีคำถามน้อยลงหนึ่งข้อ
 * (ตัวเรียกขอเกินโควตาไว้แล้ว จึงมีของสำรองให้ตัดทิ้งได้)
 */
export function validateQuestion(
  raw: RawQuestion,
  stage: Stage,
  pointValue: number,
  /**
   * ข่าวที่ระบบดึงมาจริงในรอบนี้ เรียงตามลำดับที่แสดงใน prompt ([1] = index 0)
   *
   * โมเดลบอกมาแค่ "หมายเลข" ส่วนลิงก์กับชื่อสำนักข่าว ฝั่งเราหยิบเองจากลำดับนี้
   * ที่ต้องทำแบบนี้เพราะเดิมให้โมเดลคัดลอก URL มาเอง ซึ่งกัน URL ปลอมได้ก็จริง
   * (เช็กว่าอยู่ใน allowlist) แต่ **กันการหยิบผิดชิ้นไม่ได้เลย** — โมเดลเขียนคำถาม
   * จากข่าว [7] แล้วแปะลิงก์ของ [3] ก็ผ่านการตรวจ เพราะทั้งคู่เป็นลิงก์จริง
   * ผลคือผู้เล่นกดแล้วเจอเรื่องคนละเรื่อง ซึ่งพังกว่าลิงก์เสียเสียอีก
   */
  news?: NewsItem[],
): Question | null {
  const prompt = clean(raw.prompt);
  if (prompt.length < 12) return null;

  const format = (["choice", "open", "performance"] as const).includes(
    raw.format as QuestionFormat,
  )
    ? (raw.format as QuestionFormat)
    : null;
  if (!format) return null;

  const hints = {
    real: cleanList(raw.hints?.real),
    fake: cleanList(raw.hints?.fake),
  };
  // ไม่มีคำใบ้ครบทั้งสองฝั่ง = เล่นไม่ได้ เพราะกล่องต้องมีทั้งจริงและหลอกอย่างน้อยอย่างละ 1
  if (hints.real.length < 2 || hints.fake.length < 2) return null;

  const explanation = clean(raw.explanation);
  if (!explanation) return null;

  const category = CATEGORIES.includes(raw.category as Category)
    ? (raw.category as Category)
    : "ชีวิตจริง";
  const difficulty = DIFFICULTIES.includes(raw.difficulty as Difficulty)
    ? (raw.difficulty as Difficulty)
    : "กลาง";

  // โจทย์ภาพต้องมีทั้งคำอธิบายภาพและตำแหน่งจุดผิด ขาดอย่างใดอย่างหนึ่ง
  // ก็ใช้เป็นโจทย์ภาพไม่ได้ ให้ตกเป็นคำถามข้อความธรรมดาแทน
  const imagePrompt = clean(raw.imagePrompt);
  const errorZone = (HINT_ZONES as readonly string[]).includes(clean(raw.errorZone))
    ? (clean(raw.errorZone) as HintZone)
    : undefined;
  const withImage = imagePrompt.length > 20 && errorZone ? { imagePrompt, errorZone } : {};

  // แหล่งอ้างอิงมาจาก "หมายเลขข่าว" ที่โมเดลระบุ แล้วเราหยิบลิงก์เอง
  // 0 หรือเลขนอกช่วง = ไม่แปะแหล่งอ้างอิง ซึ่งเป็นผลลัพธ์ที่ยอมรับได้
  // ดีกว่าแปะของที่ไม่ตรงกับเนื้อหา
  const index = Number.isInteger(raw.sourceIndex) ? Number(raw.sourceIndex) : 0;
  const picked = index >= 1 && news && index <= news.length ? news[index - 1] : undefined;
  // บังคับให้เขียนได้ว่าข่าวเกี่ยวกับข้อนี้ตรงไหน — ถ้าเขียนไม่ออกก็คือไม่เกี่ยว
  const withSource =
    picked && clean(raw.sourceNote).length >= 8
      ? { sourceUrl: picked.link, sourceName: picked.source }
      : {};
  if (picked && !("sourceUrl" in withSource)) {
    console.warn(`[questions] ทิ้งแหล่งอ้างอิง [${index}] เพราะไม่ได้บอกว่าเกี่ยวกันตรงไหน`);
  }

  const base = {
    // id ต้องมาจากตัวคำถามล้วน ๆ ห้ามผูกกับลำดับที่โมเดลส่งมา
    // ไม่งั้นคำถามเดิมที่โผล่มาอีกรอบจะได้ id ใหม่ แล้วความจำกันซ้ำจะจับไม่ได้
    id: `live-${stage}-${fingerprintShort(prompt)}`,
    ...withImage,
    ...withSource,
    category,
    stage,
    difficulty,
    format,
    pointValue,
    prompt,
    explanation,
    hints,
  };

  if (format === "choice") {
    const choices = cleanList(raw.choices);
    const correctAnswer = clean(raw.correctAnswer);
    if (choices.length !== 4) return null;
    if (new Set(choices).size !== 4) return null;
    if (!choices.includes(correctAnswer)) return null;
    // ตัวเลือกที่ยาวกว่าเพื่อนเกินสองเท่าคือใบ้เฉลยกลาย ๆ ผู้เล่นเดาถูกโดยไม่ต้องคิด
    const lengths = choices.map((c) => c.length);
    if (Math.max(...lengths) > Math.min(...lengths) * 3) return null;
    return { ...base, choices, correctAnswer };
  }

  const rubric = clean(raw.rubric);
  if (!rubric) return null;

  if (format === "open") {
    const keyPoints = cleanList(raw.keyPoints);
    if (keyPoints.length < 2) return null;
    return { ...base, rubric, keyPoints };
  }

  const task = clean(raw.task);
  if (!task) return null;
  return { ...base, rubric, task };
}

/** id ต้องไม่ชนกันข้ามเกม เพราะ /api/hint ใช้ id หาข้อในคลังตั้งต้นก่อน */
function fingerprintShort(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

// ────────────────────────────────────────────────────────────────────────────
// แผนรูปแบบคำถามของแต่ละช่วง
// ────────────────────────────────────────────────────────────────────────────

/**
 * สัดส่วนคร่าว ๆ ต่อช่วง — ยึดจากคลังตั้งต้นที่ทีมงานเขียนไว้
 * อัตนัยเยอะกว่าปรนัยตามที่ตกลงกันไว้ และทุกช่วงต้องมีโจทย์โชว์ความสามารถอย่างน้อย 1
 */
function planFormats(stage: Stage, count: number): QuestionFormat[] {
  const performance = Math.max(1, Math.round(count * 0.2));
  const open = Math.max(1, Math.round(count * (stage === "warmup" ? 0.3 : 0.4)));
  const choice = Math.max(0, count - performance - open);
  return [
    ...Array<QuestionFormat>(choice).fill("choice"),
    ...Array<QuestionFormat>(open).fill("open"),
    ...Array<QuestionFormat>(performance).fill("performance"),
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// ตัวเรียกหลัก
// ────────────────────────────────────────────────────────────────────────────

export interface StageRequest {
  stage: Stage;
  count: number;
  pointValue: number;
}

export interface GenerateOptions {
  stages: StageRequest[];
  groups: FeedGroup[];
  avoid: string[];
  /** อยากได้โจทย์ "หาจุดผิดจากภาพ" กี่ข้อต่อเกม */
  imageCount: number;
  llm?: LlmChoiceInput | null;
}

export interface GenerateResult {
  questions: Question[];
  /** ช่วงไหนสร้างได้ไม่ครบบ้าง — ตัวเรียกจะได้เติมจากคลังในเครื่อง */
  shortfall: Record<string, number>;
  sourcesUsed: string[];
  feedsFailed: string[];
  /** สาเหตุจริงที่เรียกโมเดลไม่สำเร็จ — เอาไปแสดงในหลังบ้าน */
  errors: string[];
}

/**
 * ขอเกินโควตาไว้ เพราะ validateQuestion() ตัดทิ้งได้เสมอ
 *
 * ขยับจาก 1.35 → 1.6 หลังเพิ่มกฎ "ต้องคิดหลายชั้น" กับ "ตัวลวงต้องเนียน"
 * วัดจริงแล้วขอ 6 ข้อได้กลับมา 4 (ตกไป 33%) เพราะข้อที่ตื้นเกินไปถูกตัดมากขึ้น
 * ก้อนที่เพิ่มขึ้นยิงขนานกันอยู่แล้ว เวลารวมจึงแทบไม่เปลี่ยน
 */
const OVERSHOOT = 1.6;

/**
 * แต่งทีละ 4 ข้อต่อการเรียก 1 ครั้ง แล้วยิงทุกก้อนขนานกัน
 *
 * วัดจริงแล้วโมเดลใช้เวลา ~12 วิต่อคำถาม 1 ข้อ (เพราะแต่ละข้อพ่วงคำใบ้ 6 อัน)
 * ถ้าขอ 13 ข้อในครั้งเดียวจะใช้เวลาเกิน 150 วิ ทะลุเพดาน 60 วิของ Vercel ไปไกล
 * การแตกเป็นก้อนเล็กทำให้เวลารวมเท่ากับก้อนที่ช้าที่สุด ไม่ใช่ผลรวม
 *
 * ลดจาก 4 → 2 หลังบังคับให้เฉลยกางการคำนวณทีละขั้น ซึ่งทำให้ output ต่อข้อ
 * ยาวขึ้นมาก วัดจริงแล้วก้อนละ 4 ข้อพุ่งไปถึง ~50 วิ ชนเพดาน 60 วิจนได้คำถาม
 * กลับมาไม่ครบ (ขอ 20 ได้ 9) ก้อนละ 2 ข้อทำให้แต่ละคำเร็วขึ้นเท่าตัว
 * ส่วนจำนวนก้อนที่มากขึ้นยิงขนานกันอยู่แล้ว
 *
 * ผลพลอยได้: แต่ละก้อนได้บรีฟและข่าวคนละชุด คำถามจึงกระจายกว่าการขอรวดเดียว
 */
const CHUNK_SIZE = 2;

interface Chunk {
  stage: Stage;
  pointValue: number;
  count: number;
  index: number;
}

function planChunks(stages: StageRequest[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const req of stages) {
    const ask = Math.ceil(req.count * OVERSHOOT);
    let remaining = ask;
    let index = 0;
    while (remaining > 0) {
      const size = Math.min(CHUNK_SIZE, remaining);
      chunks.push({ stage: req.stage, pointValue: req.pointValue, count: size, index });
      remaining -= size;
      index += 1;
    }
  }
  return chunks;
}

/** หมุนลิสต์ข่าวให้แต่ละก้อนเริ่มคนละจุด จะได้ไม่หยิบชิ้นเดิมไปตั้งคำถามเหมือนกัน */
function rotate<T>(list: T[], by: number): T[] {
  if (list.length === 0) return list;
  const offset = (by * 7) % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

export async function generateQuestions(options: GenerateOptions): Promise<GenerateResult> {
  const choice = resolveLlm(options.llm);
  const errors: string[] = [];
  const empty: GenerateResult = {
    questions: [],
    shortfall: Object.fromEntries(options.stages.map((s) => [s.stage, s.count])),
    sourcesUsed: [],
    feedsFailed: [],
    errors,
  };
  if (!isChoiceReady(choice)) {
    errors.push(`ยังไม่มีคีย์ของ ${choice.provider} ให้ใช้ — ไปใส่ที่แท็บ API ก่อน`);
    return empty;
  }

  const totalWanted = options.stages.reduce((sum, s) => sum + s.count, 0);
  const news = await harvest(options.groups, {
    perFeed: 4,
    total: Math.max(30, totalWanted * 2),
    maxFeeds: 18,
  });
  // ไม่มีข่าวเลย = เน็ตล่มหรือฟีดตายหมด ปล่อยให้ตัวเรียกไปใช้คลังในเครื่องแทน
  if (news.items.length < 6) {
    errors.push(
      `ดึงข่าวได้แค่ ${news.items.length} ชิ้น ไม่พอจะตั้งคำถาม ` +
        `(ฟีดที่ล้ม: ${news.failed.slice(0, 3).join(", ") || "—"})`,
    );
    return { ...empty, feedsFailed: news.failed };
  }

  const chunks = planChunks(options.stages);

  /**
   * กระจายโควตาโจทย์ภาพให้ทั่วทั้งเกม ทีละก้อนไม่เกิน 1 ข้อ
   *
   * ถ้าไม่กระจาย โมเดลจะกองโจทย์ภาพไว้ในก้อนเดียวจนช่วงนั้นเป็นภาพหมด
   * ส่วนช่วงอื่นไม่มีเลย — ผู้ใช้ขอไว้ว่า "สลับไปสลับมา"
   * เผื่อไว้เกินโควตาเล็กน้อยเพราะบางข้อจะโดนตัวตรวจตัดทิ้ง
   */
  const imageQuota = Math.min(options.imageCount, chunks.length);
  const imagePlan = chunks.map((_, i) => (i < imageQuota ? 1 : 0));

  const results = await Promise.all(
    chunks.map(async (chunk, chunkIndex) => {
      const formatPlan = planFormats(chunk.stage, chunk.count);
      const seeds = drawSeeds(chunk.count);
      const tasks = drawPerformanceTasks(
        formatPlan.filter((f) => f === "performance").length,
      );

      const payload = await callLlmJson<{ questions?: RawQuestion[] }>(choice, {
        system: SYSTEM,
        prompt: buildPrompt({
          stage: chunk.stage,
          count: chunk.count,
          formatPlan,
          seeds,
          tasks,
          news: rotate(news.items, chunkIndex).slice(0, 18),
          avoid: options.avoid,
          imageCount: imagePlan[chunkIndex] ?? 0,
        }),
        schema: QUESTION_SCHEMA as unknown as Record<string, unknown>,
        // คำถามพร้อมคำใบ้ 6 อันต่อข้อกินโทเคนเยอะ เผื่อไว้มากกว่างานอื่น
        maxTokens: 8_000,
        tag: `questions:${chunk.stage}#${chunk.index}`,
        errorSink: errors,
        timeoutMs: 50_000,
      });

      return { chunk, raws: payload?.questions ?? [] };
    }),
  );

  // รวมทุกก้อนแล้วค่อยตัดซ้ำทีเดียว — ก้อนต่างกันมองไม่เห็นกัน จึงแต่งชนกันได้
  const byStage = new Map<Stage, Question[]>();
  const seen = new Set<string>();
  for (const { chunk, raws } of results) {
    for (const raw of raws) {
      // ส่งชุดข่าวชุดเดียวกับที่แปะไปใน prompt เพื่อให้หมายเลข [n] ตรงกัน
      const q = validateQuestion(raw, chunk.stage, chunk.pointValue, news.items);
      if (!q) continue;
      const key = fingerprintShort(q.prompt);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = byStage.get(chunk.stage) ?? [];
      list.push(q);
      byStage.set(chunk.stage, list);
    }
  }

  const questions: Question[] = [];
  const shortfall: Record<string, number> = {};
  for (const req of options.stages) {
    const got = (byStage.get(req.stage) ?? []).slice(0, req.count);
    questions.push(...got);
    if (got.length < req.count) shortfall[req.stage] = req.count - got.length;
  }

  /**
   * ด่านที่หนึ่งของแหล่งอ้างอิง — ยิงจริงดูว่าเปิดได้ไหม
   *
   * ลิงก์มาจากชุดข่าวที่เราดึงเองแล้ว จึงไม่มีทางเป็น URL ที่โมเดลแต่งขึ้น
   * แต่ยังไม่ได้แปลว่าเปิดได้ — ฟีดเองก็ให้ลิงก์เสียมาได้ (เจอกับ FTC มาแล้ว)
   * ตรงนี้จึงตัดทิ้งทุกตัวที่ยืนยันไม่ได้ ยอมให้บางข้อไม่มีแหล่งอ้างอิง
   * ดีกว่าโชว์ลิงก์ที่กดแล้วเจอ 404 หรือหน้าเปล่า
   */
  const cited = questions
    .map((q) => q.sourceUrl)
    .filter((url): url is string => Boolean(url));
  if (cited.length > 0) {
    const working = await verifyLinks(cited);
    for (const q of questions) {
      if (q.sourceUrl && !working.has(q.sourceUrl)) {
        delete q.sourceUrl;
        delete q.sourceName;
      }
    }
  }

  await stripUnrelatedSources(questions, news.items, choice);

  return {
    questions,
    shortfall,
    sourcesUsed: news.ok,
    feedsFailed: news.failed,
    // ตัดให้เหลือไม่กี่บรรทัด — ทุกก้อนที่พังมักพังด้วยเหตุผลเดียวกัน
    errors: [...new Set(errors)].slice(0, 3),
  };
}

const RELEVANCE_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "หมายเลขคู่ที่ตรวจ" },
          score: {
            type: "integer",
            description:
              "0-10 · บทความนี้เป็น 'ที่มาของประเด็น' ในคำถามได้แค่ไหน " +
              "10 = เรื่องเดียวกันเป๊ะ · 5 = อยู่ในเรื่องเดียวกันแต่คนละแง่มุม · 0 = คนละเรื่องสิ้นเชิง",
          },
        },
        required: ["index", "score"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

/**
 * ด่านที่สองของแหล่งอ้างอิง — บทความที่แปะ พูดเรื่องเดียวกับคำถามจริงไหม
 *
 * ทำไมต้องมีทั้งที่ให้โมเดลระบุหมายเลขข่าวเองแล้ว: การให้ระบุหมายเลขกันได้แค่
 * "ลิงก์ไม่ตรงกับข่าวที่มันบอกว่าใช้" แต่กันไม่ได้เลยว่ามันจะเลือกข่าวที่ไม่เกี่ยว
 * ตอนที่หาชิ้นที่เกี่ยวไม่เจอ — ทดสอบจริงแล้วเจอคำถามเรื่องประกันภัยไปแปะบทความ
 * สูตรมัฟฟินมอสซาเรลลาของ The Guardian ซึ่งเป็นลิงก์ที่เปิดได้และอยู่ในชุดที่ดึงมาจริง
 * จึงผ่านทุกด่านก่อนหน้านี้ไปได้หมด
 *
 * ยิงรวมทีเดียวทุกข้อ (~2-4 วิ) แล้วตัดเฉพาะคู่ที่ไม่ผ่าน ไม่ทิ้งทั้งคำถาม
 * เพราะคำถามยังดีอยู่ เสียแค่แหล่งอ้างอิง — ไม่มีแหล่งดีกว่าแหล่งที่ไม่ตรง
 */
async function stripUnrelatedSources(
  questions: Question[],
  news: NewsItem[],
  choice: LlmChoice,
): Promise<void> {
  const pairs = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => Boolean(q.sourceUrl))
    .map(({ q, i }) => ({ q, i, item: news.find((n) => n.link === q.sourceUrl) }))
    .filter((p): p is { q: Question; i: number; item: NewsItem } => Boolean(p.item));

  if (pairs.length === 0 || !isChoiceReady(choice)) return;

  const listing = pairs
    .map(
      (p, n) =>
        `[${n + 1}] คำถาม: ${p.q.prompt.slice(0, 200)}\n` +
        `     บทความ: ${p.item.title}${p.item.summary ? ` — ${p.item.summary.slice(0, 200)}` : ""}`,
    )
    .join("\n\n");

  try {
    const parsed = await callLlmJson<{ verdicts?: Array<{ index?: number; score?: number }> }>(
      choice,
      {
        system:
          "ป้ายที่แสดงบนจอเขียนว่า \"ที่มาของประเด็น\" — ไม่ใช่ \"หลักฐานยืนยันคำตอบ\"\n" +
          "คุณจึงให้คะแนนแค่ว่า บทความนี้เป็นที่มาของประเด็นในคำถามได้แค่ไหน\n\n" +
          "เกณฑ์: ผู้เล่นกดลิงก์เข้าไปอ่านแล้วรู้สึกว่า \"อ๋อ ประเด็นนี้มาจากเรื่องนี้เอง\"\n" +
          "หรือรู้สึกว่า \"นี่มันคนละเรื่องกันเลย ทำไมเอามาแปะ\"\n\n" +
          "  9-10 = เรื่องเดียวกันเป๊ะ (คำถามกฎถอนเงินเกษียณ 4% ↔ บทความเรื่องกฎ 4%)\n" +
          "  6-8  = อยู่ในเรื่องเดียวกัน คนละแง่มุม (คำถามนอนตอนร้อน ↔ บทความสุขภาพการนอน)\n" +
          "  3-5  = แตะกันห่าง ๆ ในหมวดเดียวกัน (คำถามออมเงิน ↔ ข่าวดอกเบี้ยธนาคารกลาง)\n" +
          "  0-2  = คนละเรื่องสิ้นเชิง (คำถามประกันรถ ↔ บทความสูตรมัฟฟิน)\n\n" +
          "⚠️ คำถามไม่จำเป็นต้องถามเรื่องที่อยู่ในบทความตรง ๆ และผู้เล่นต้องตอบได้\n" +
          "โดยไม่ต้องอ่านบทความ — นั่นคือดีไซน์ของเกม ไม่ใช่เหตุผลให้หักคะแนน\n" +
          "ให้ดูแค่ว่า 'เรื่อง' เดียวกันไหม\n\n" +
          "ต้องตอบให้ครบทุกคู่ตามลำดับที่ให้มา ห้ามข้าม",
        prompt: `ให้คะแนนทีละคู่แล้วตอบเป็น JSON ตามสคีมา (ตอบให้ครบ ${pairs.length} คู่):\n\n${listing}`,
        schema: RELEVANCE_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 2000,
        tag: "source-relevance",
      },
    );

    const verdicts = parsed?.verdicts ?? [];
    /**
     * จับคู่คำตัดสินกลับเข้ากับคำถาม
     *
     * ตอนแรกใช้ `index` ที่โมเดลส่งกลับมาอย่างเดียว แล้วแหล่งอ้างอิงถูกตัดทิ้งหมดทุกข้อ
     * รวมถึงคู่ที่ตรงกันชัด ๆ (คำถามกฎ 4% กับบทความ "Does the 4% rule still work?")
     * เพราะเลขที่ส่งกลับมาไม่ได้เริ่มที่ 1 เสมอไป — ใช้ลำดับในอาร์เรย์เมื่อจำนวนตรงกัน
     * จะแม่นกว่า แล้วค่อยถอยไปใช้ index (รับทั้งฐาน 0 และ 1) เมื่อจำนวนไม่ตรง
     */
    /**
     * เกณฑ์ผ่านที่ 4 เต็ม 10 — คือ "อยู่ในเรื่องเดียวกันแม้จะคนละแง่มุม"
     *
     * เดิมให้ตัวตรวจตอบ true/false แล้วมันตอบ false ทุกคู่ทุกรอบ แม้กับคู่ที่ตรงกันชัด
     * เพราะคำถามในเกมถูกออกแบบให้ "ตอบได้โดยไม่ต้องอ่านข่าว" อยู่แล้ว บทความจึงไม่เคย
     * ตรงกับคำถามแบบเป๊ะ ๆ ตัวตรวจเลยยึดกับ false ตลอด · ให้เป็นคะแนนแทนทำให้มันไล่
     * ระดับความใกล้เคียงได้ ไม่ต้องตัดสินขาวดำในสิ่งที่เป็นสเปกตรัม
     */
    const PASS = 4;
    console.info(
      `[questions] ตรวจแหล่งอ้างอิง ${pairs.length} คู่ · ตอบกลับ ${verdicts.length} รายการ` +
        ` · คะแนน: ${verdicts.map((v) => v.score).join(",")}`,
    );
    const ordered = verdicts.length === pairs.length;
    const byIndex = new Map(verdicts.map((v) => [Number(v.index), Number(v.score)]));

    for (const [n, p] of pairs.entries()) {
      const score = ordered
        ? Number(verdicts[n]?.score)
        : (byIndex.get(n + 1) ?? byIndex.get(n) ?? 0);
      if (Number.isFinite(score) && score >= PASS) continue;
      console.warn(
        `[questions] ตัดแหล่งอ้างอิงที่ไม่ตรงกับคำถาม: "${p.item.title.slice(0, 60)}"`,
      );
      delete p.q.sourceUrl;
      delete p.q.sourceName;
    }
  } catch {
    // ตรวจไม่สำเร็จ ปล่อยแหล่งอ้างอิงไว้ตามเดิม — ด่านลิงก์เปิดได้ผ่านมาแล้ว
    // ทิ้งทั้งหมดเพราะตัวตรวจล่มจะทำให้เกมไม่มีแหล่งอ้างอิงเลยทั้งที่ส่วนใหญ่ถูกต้อง
  }
}
