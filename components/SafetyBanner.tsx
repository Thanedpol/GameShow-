export default function SafetyBanner() {
  return (
    <div
      role="note"
      className="sticky top-0 z-50 border-b border-amber-400/30 bg-amber-500/15
                 px-4 py-2 text-center text-[11px] leading-snug text-amber-100
                 backdrop-blur-md sm:text-xs"
    >
      <span aria-hidden="true" className="mr-1.5">
        ⚠️
      </span>
      คำใบ้บางส่วนถูกออกแบบให้ผิดโดยตั้งใจ เพื่อทดสอบการคิดวิเคราะห์ ห้ามใช้อ้างอิงจริง
    </div>
  );
}
