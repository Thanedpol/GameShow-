import "server-only";

/**
 * ตัวเก็บ "ข่าว/บทความจริง" มาเป็นวัตถุดิบให้ AI แต่งคำถาม
 *
 * ทำไมใช้ RSS ไม่ใช่ search API:
 * - ไม่ต้องเพิ่มคีย์หรือค่าใช้จ่ายใหม่ และใช้ได้กับทุกค่าย LLM ที่รองรับอยู่
 *   (search ของแต่ละค่ายผูกกับค่ายนั้นและคิดเงินต่อครั้ง)
 * - ผลลัพธ์คงที่พอจะทดสอบซ้ำได้
 * - ฟีดเป็นบทสรุปสั้นที่เจ้าของเว็บตั้งใจเผยแพร่อยู่แล้ว จึงหยิบมาใช้ได้สบายใจกว่า
 *   การไล่ scrape เนื้อบทความเต็ม
 *
 * ⚠️ รายการฟีดเป็น allowlist ฝั่งเซิร์ฟเวอร์เท่านั้น — client ระบุ URL เองไม่ได้เด็ดขาด
 * ถ้าเปิดให้ client ส่ง URL มาคือเปิดช่อง SSRF (เหตุผลเดียวกับที่ล็อก OLLAMA_BASE_URL ไว้)
 */

export type FeedGroup =
  | "life"
  | "work"
  | "tech"
  | "money"
  | "health"
  | "science"
  | "security";

export const FEED_GROUPS: FeedGroup[] = [
  "life",
  "work",
  "tech",
  "money",
  "health",
  "science",
  "security",
];

export const FEED_GROUP_LABEL: Record<FeedGroup, string> = {
  life: "ชีวิตและวัฒนธรรม",
  work: "ธุรกิจและที่ทำงาน",
  tech: "เทคโนโลยีและ AI",
  money: "การเงินส่วนบุคคล",
  health: "สุขภาพ",
  science: "วิทยาศาสตร์",
  security: "ภัยไซเบอร์และสแกม",
};

interface FeedSource {
  name: string;
  url: string;
  group: FeedGroup;
  /** ใช้บอก LLM ว่าเรื่องนี้มาจากมุมไหนของโลก เพื่อให้คำถามกระจายตัว */
  region: string;
}

/**
 * ทุกฟีดในลิสต์นี้ถูกยิงทดสอบแล้วว่าตอบ 200 และมีรายการ ≥ 3 ภายใน timeout
 * ฟีดที่ช้าเกิน 6 วิ หรือ 403/404 ถูกคัดออกไปแล้ว
 *
 * ⚠️ ตั้งใจ "ไม่" ใส่ฟีดข่าวด่วนทั่วไป (BBC World, Al Jazeera, Reuters ฯลฯ)
 *
 * ทดลองแล้วพบว่าตัวกรองคำต้องห้ามเอาไม่อยู่จริง — ข่าวสงคราม คดีความ และ
 * การเมืองยังหลุดผ่านมาได้เรื่อย ๆ เพราะเนื้อหาส่วนใหญ่ของฟีดพวกนั้นคือเรื่องแบบนั้น
 * และเกมนี้จงใจแปะ "คำใบ้หลอก" ลงบนข้อมูล จึงไม่ควรเอาไปแตะเหตุการณ์จริง
 * ที่มีคนเดือดร้อนอยู่
 *
 * ความเป็น "ทั่วโลก" มาจากการกระจายแหล่ง (อังกฤษ สหรัฐฯ ญี่ปุ่น สิงคโปร์ ไทย
 * อินเดีย องค์กรระหว่างประเทศ) ไม่ใช่จากการตามข่าวความขัดแย้ง — และหมวดเฉพาะทาง
 * ให้วัตถุดิบที่ตรงกับโจทย์ "แก้ปัญหาชีวิตจริงและโลกการทำงาน" มากกว่าข่าวด่วนอยู่แล้ว
 */
const FEEDS: FeedSource[] = [
  // ── ชีวิตและวัฒนธรรม ──────────────────────────────────────────────────
  { name: "The Guardian Life & Style", url: "https://www.theguardian.com/lifeandstyle/rss", group: "life", region: "สหราชอาณาจักร" },
  { name: "The Guardian Food", url: "https://www.theguardian.com/food/rss", group: "life", region: "สหราชอาณาจักร" },
  { name: "Atlas Obscura", url: "https://www.atlasobscura.com/feeds/latest", group: "life", region: "ทั่วโลก" },
  // ตั้งใจไม่ใส่ Lifehacker — ฟีดหลักเป็นโพสต์ลดราคาสินค้าเสียส่วนใหญ่ ใช้ตั้งคำถามไม่ได้
  { name: "Mental Floss", url: "https://www.mentalfloss.com/rss.xml", group: "life", region: "สหรัฐอเมริกา" },
  { name: "Smithsonian Magazine", url: "https://www.smithsonianmag.com/rss/latest_articles/", group: "life", region: "สหรัฐอเมริกา" },
  { name: "CNA Lifestyle", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416", group: "life", region: "สิงคโปร์/อาเซียน" },
  { name: "Bangkok Post Life", url: "https://www.bangkokpost.com/rss/data/life.xml", group: "life", region: "ไทย" },
  { name: "Times of India Lifestyle", url: "https://timesofindia.indiatimes.com/rssfeeds/2886704.cms", group: "life", region: "อินเดีย" },

  // ── ธุรกิจและที่ทำงาน ─────────────────────────────────────────────────
  { name: "Fast Company", url: "https://www.fastcompany.com/latest/rss", group: "work", region: "สหรัฐอเมริกา" },
  { name: "Inc.", url: "https://www.inc.com/rss", group: "work", region: "สหรัฐอเมริกา" },
  { name: "Entrepreneur", url: "https://www.entrepreneur.com/latest.rss", group: "work", region: "สหรัฐอเมริกา" },
  { name: "The Guardian Careers", url: "https://www.theguardian.com/careers/rss", group: "work", region: "สหราชอาณาจักร" },
  { name: "The Guardian Work", url: "https://www.theguardian.com/money/work-and-careers/rss", group: "work", region: "สหราชอาณาจักร" },
  { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", group: "work", region: "สหราชอาณาจักร/ทั่วโลก" },
  { name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar", group: "work", region: "ญี่ปุ่น/เอเชีย" },
  { name: "Bangkok Post Business", url: "https://www.bangkokpost.com/rss/data/business.xml", group: "work", region: "ไทย" },
  { name: "Times of India Business", url: "https://timesofindia.indiatimes.com/rssfeeds/1898055.cms", group: "work", region: "อินเดีย" },

  // ── เทคโนโลยีและ AI ───────────────────────────────────────────────────
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", group: "tech", region: "สหรัฐอเมริกา" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", group: "tech", region: "สหรัฐอเมริกา" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", group: "tech", region: "สหรัฐอเมริกา" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", group: "tech", region: "สหรัฐอเมริกา" },

  // ── การเงินส่วนบุคคล ──────────────────────────────────────────────────
  { name: "NerdWallet", url: "https://www.nerdwallet.com/blog/feed/", group: "money", region: "สหรัฐอเมริกา" },
  { name: "The Guardian Money", url: "https://www.theguardian.com/money/rss", group: "money", region: "สหราชอาณาจักร" },
  { name: "CNBC Personal Finance", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=21324812", group: "money", region: "สหรัฐอเมริกา" },
  { name: "BBC Your Money", url: "https://feeds.bbci.co.uk/news/business/your_money/rss.xml", group: "money", region: "สหราชอาณาจักร" },
  { name: "Which?", url: "https://www.which.co.uk/news/feed", group: "money", region: "สหราชอาณาจักร" },

  // ── สุขภาพ ────────────────────────────────────────────────────────────
  { name: "WHO News", url: "https://www.who.int/rss-feeds/news-english.xml", group: "health", region: "องค์การระหว่างประเทศ" },
  { name: "The Guardian Wellbeing", url: "https://www.theguardian.com/lifeandstyle/health-and-wellbeing/rss", group: "health", region: "สหราชอาณาจักร" },
  { name: "Healthline", url: "https://www.healthline.com/rss/health-news", group: "health", region: "สหรัฐอเมริกา" },

  // ── วิทยาศาสตร์ ───────────────────────────────────────────────────────
  { name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", group: "science", region: "สหรัฐอเมริกา" },
  { name: "Phys.org", url: "https://phys.org/rss-feed/", group: "science", region: "ทั่วโลก" },
  { name: "Nature", url: "https://www.nature.com/nature.rss", group: "science", region: "สหราชอาณาจักร/ทั่วโลก" },
  { name: "NASA", url: "https://www.nasa.gov/news-release/feed/", group: "science", region: "สหรัฐอเมริกา" },
  { name: "Quanta Magazine", url: "https://api.quantamagazine.org/feed/", group: "science", region: "สหรัฐอเมริกา" },
  { name: "The Guardian Science", url: "https://www.theguardian.com/science/rss", group: "science", region: "สหราชอาณาจักร" },
  { name: "BBC Science", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", group: "science", region: "สหราชอาณาจักร/ทั่วโลก" },

  // ── ภัยไซเบอร์และสแกม ─────────────────────────────────────────────────
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", group: "security", region: "สหรัฐอเมริกา" },
  { name: "FTC Consumer Alerts", url: "https://consumer.ftc.gov/blog/rss", group: "security", region: "สหรัฐอเมริกา" },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", group: "security", region: "ทั่วโลก" },
  { name: "Schneier on Security", url: "https://www.schneier.com/feed/atom/", group: "security", region: "สหรัฐอเมริกา" },
  { name: "Have I Been Pwned", url: "https://feeds.feedburner.com/HaveIBeenPwnedLatestBreaches", group: "security", region: "ทั่วโลก" },
];

export interface NewsItem {
  title: string;
  summary: string;
  /** ชื่อสำนักข่าว — ใช้บอกผู้เล่นตอนสรุปผลว่าคำถามมาจากไหน */
  source: string;
  region: string;
  group: FeedGroup;
}

// ────────────────────────────────────────────────────────────────────────────
// ตัวกรองเนื้อหาที่ไม่ควรเอามาทำเป็นเกม
// ────────────────────────────────────────────────────────────────────────────

/**
 * ด่านที่สอง — ถึงจะเลี่ยงฟีดข่าวด่วนแล้ว หมวดเฉพาะทางก็ยังมีเรื่องหนักปนมาได้
 * (Guardian Life เขียนเรื่องความสูญเสีย · BBC Science รายงานภัยพิบัติ)
 *
 * ตั้งใจ "ไม่" ใส่คำที่ทับกับศัพท์ที่เกมนี้อยากได้:
 *   attack   — cyberattack / heart attack คือเนื้อหาหลักของหมวดภัยไซเบอร์และสุขภาพ
 *   conflict — ความขัดแย้งในทีมคือโจทย์ที่ราคาแพงที่สุดของหมวดที่ทำงาน
 *   breach   — ข้อมูลรั่วคือหัวใจของหมวดสแกม
 * สามคำนี้ปล่อยผ่านได้เพราะไม่มีฟีดข่าวสงคราม/การเมืองอยู่ในลิสต์แล้ว
 */
const BLOCKED_EN = new RegExp(
  "\\b(?:" +
    [
      // ความรุนแรงต่อคนและความสูญเสีย
      "kill(?:s|ed|ing|ings)?",
      "murder(?:s|ed|ous)?",
      "death(?:s)?",
      "die(?:s|d)",
      "dead",
      "dying",
      "fatal(?:ity|ities|ly)?",
      "massacre(?:s|d)?",
      "genocide",
      "atrocit(?:y|ies)",
      "execution(?:s)?",
      "assassinat(?:e|ed|ion)",
      "shooting(?:s)?",
      "stabb(?:ing|ings|ed)",
      "torture(?:d)?",
      "rape(?:d|s)?",
      "sexual (?:assault|conduct|abuse|misconduct)",
      "traffick(?:ing|ed)",
      "kidnap(?:ped|ping)?",
      "abduct(?:ed|ion)?",
      "hostage(?:s)?",
      "terroris(?:m|t|ts)",
      "suicide",
      "self-harm",
      "overdose(?:s|d)?",
      "casualt(?:y|ies)",
      "funeral(?:s)?",
      "mourn(?:s|ing|ers)?",
      "obituar(?:y|ies)",
      "condolence(?:s)?",
      "grief",
      // สงคราม
      "war",
      "wars",
      "warfare",
      "warship(?:s)?",
      "invasion",
      "invade(?:s|d)?",
      "airstrike(?:s)?",
      "bomb(?:s|ed|ing|ings)?",
      "missile(?:s)?",
      "shelling",
      "artillery",
      "militant(?:s)?",
      "insurgen(?:t|ts|cy)",
      "ceasefire",
      "truce",
      "troops",
      "taliban",
      "siege",
      // ภัยพิบัติและอุบัติเหตุ
      "earthquake(?:s)?",
      "quake(?:s)?",
      "crisis",
      "crises",
      "tragedy",
      "tragic",
      "outbreak(?:s)?",
      "epidemic(?:s)?",
      "pandemic(?:s)?",
      "tsunami",
      "hurricane(?:s)?",
      "typhoon(?:s)?",
      "cyclone(?:s)?",
      "wildfire(?:s)?",
      "landslide(?:s)?",
      "famine",
      "eruption",
      "disaster(?:s)?",
      "wounded",
      "evacuat(?:e|ed|ion|ions)",
      "crash(?:es|ed)?",
      "collision",
      "derail(?:ed|ment)?",
      "wreckage",
      // คดีความ
      "verdict(?:s)?",
      "indict(?:ed|ment)?",
      "lawsuit(?:s)?",
      "convict(?:ed|ion)?",
      "acquitt(?:ed|al)",
      "arrest(?:s|ed)?",
      "prosecut(?:e|ed|or|ion)",
      "on trial",
      "jail(?:ed)?",
      "prison",
      "sentenced",
      "accuse(?:s|d)",
      "allegation(?:s)?",
      // การเมือง
      "impeach(?:ed|ment)?",
      "coup",
      "junta",
      "protest(?:s|ers|ing)?",
      "riot(?:s|ing|ers)?",
      "unrest",
      "election(?:s)?",
      "referendum",
      "sanction(?:s|ed)?",
      "deport(?:ed|ation)?",
      "refugee(?:s)?",
      "asylum",
      "parliament",
      "senator(?:s)?",
      "president",
      "prime minister",
      "trump",
      "putin",
      "netanyahu",
    ].join("|") +
    ")\\b",
  "i",
);

const BLOCKED_TH =
  /(ฆ่า|เสียชีวิต|ผู้เสียชีวิต|ศพ|ฆาตกร|ข่มขืน|ทรมาน|ค้ามนุษย์|ลักพาตัว|ตัวประกัน|ก่อการร้าย|ฆ่าตัวตาย|งานศพ|ไว้อาลัย|สงคราม|ระเบิด|ขีปนาวุธ|แผ่นดินไหว|สึนามิ|น้ำท่วม|ไฟไหม้|ภัยพิบัติ|อุบัติเหตุ|บาดเจ็บ|จับกุม|ฟ้องร้อง|ศาลตัดสิน|จำคุก|เลือกตั้ง|ประท้วง|รัฐประหาร|นายกรัฐมนตรี|ประธานาธิบดี|รัฐสภา)/;

function isSafeItem(text: string): boolean {
  return !BLOCKED_EN.test(text) && !BLOCKED_TH.test(text);
}

// ────────────────────────────────────────────────────────────────────────────
// แกะ XML
// ────────────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

/** เอาแท็ก HTML ที่ฝังมาในคำบรรยายออก แล้วยุบช่องว่างให้เหลือช่องเดียว */
function toPlainText(raw: string): string {
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutTags = withoutCdata.replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

/** ดึงเนื้อในแท็กแรกที่เจอ — ฟีดจริงมีทั้งแบบมี attribute และไม่มี */
function tagContent(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1] : null;
}

const MAX_SUMMARY = 400;

function parseFeed(xml: string, feed: FeedSource, limit: number): NewsItem[] {
  // RSS 2.0 / RDF ใช้ <item> ส่วน Atom ใช้ <entry> — รับทั้งคู่
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const items: NewsItem[] = [];
  for (const block of blocks) {
    if (items.length >= limit) break;

    const title = toPlainText(tagContent(block, "title") ?? "");
    if (title.length < 12) continue;

    const summaryRaw =
      tagContent(block, "description") ??
      tagContent(block, "summary") ??
      tagContent(block, "content:encoded") ??
      "";
    const summary = toPlainText(summaryRaw).slice(0, MAX_SUMMARY);

    if (!isSafeItem(`${title} ${summary}`)) continue;

    items.push({ title, summary, source: feed.name, region: feed.region, group: feed.group });
  }
  return items;
}

// ────────────────────────────────────────────────────────────────────────────
// ดึงฟีด
// ────────────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_BYTES = 2_000_000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; BaiJingBaiLok/1.0; +https://game-show.vercel.app)";

/**
 * แคชในหน่วยความจำของ instance
 *
 * มีทั้งอันนี้และ `next: { revalidate }` เพราะบน serverless แต่ละ instance
 * อยู่ไม่นานและ data cache ของ Next ก็ข้ามการแคชเมื่อ response ใหญ่เกิน
 * ตัวนี้จึงเป็นด่านที่พึ่งได้จริงเวลามีคนเริ่มเกมติด ๆ กันบน instance เดียว
 */
const cache = new Map<string, { at: number; items: NewsItem[] }>();

async function fetchFeed(feed: FeedSource, perFeed: number): Promise<NewsItem[]> {
  const cached = cache.get(feed.url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.items;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      next: { revalidate: 900 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error(`ฟีดใหญ่เกิน (${text.length} ไบต์)`);

    const items = parseFeed(text, feed, perFeed);
    cache.set(feed.url, { at: Date.now(), items });
    return items;
  } finally {
    clearTimeout(timer);
  }
}

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface HarvestResult {
  items: NewsItem[];
  /** ชื่อฟีดที่ดึงสำเร็จ — เอาไปโชว์ในหลังบ้านเวลาไล่ปัญหา */
  ok: string[];
  failed: string[];
}

/**
 * ดึงข่าวจากกลุ่มที่เลือก
 *
 * ยิงทุกฟีดขนานกันด้วย allSettled — ฟีดไหนล่มหรือช้าเกิน timeout ก็ข้ามไป
 * ไม่ลากทั้งชุดล้มตาม เพราะเกมต้องเริ่มได้เสมอ
 *
 * สุ่มลำดับฟีดก่อนตัดจำนวน เพื่อไม่ให้ข่าวมาจากสำนักเดิมทุกครั้ง
 */
export async function harvest(
  groups: FeedGroup[],
  options: { perFeed?: number; total?: number; maxFeeds?: number } = {},
): Promise<HarvestResult> {
  const perFeed = options.perFeed ?? 4;
  const total = options.total ?? 45;
  const maxFeeds = options.maxFeeds ?? 16;

  const wanted = groups.length > 0 ? groups : FEED_GROUPS;
  const pool = FEEDS.filter((f) => wanted.includes(f.group));
  const chosen = shuffle(pool).slice(0, maxFeeds);

  const settled = await Promise.allSettled(chosen.map((f) => fetchFeed(f, perFeed)));

  const ok: string[] = [];
  const failed: string[] = [];
  const collected: NewsItem[][] = [];

  settled.forEach((result, index) => {
    const feed = chosen[index];
    if (result.status === "fulfilled" && result.value.length > 0) {
      ok.push(feed.name);
      collected.push(result.value);
    } else {
      failed.push(feed.name);
    }
  });

  // สลับหยิบทีละฟีด (round-robin) แทนการต่อท้ายกันตรง ๆ
  // ไม่งั้นฟีดแรกจะกินโควตาไปหมดแล้วข่าวทั้งชุดมาจากที่เดียว
  const items: NewsItem[] = [];
  for (let round = 0; items.length < total; round += 1) {
    let added = false;
    for (const list of collected) {
      if (round >= list.length) continue;
      items.push(list[round]);
      added = true;
      if (items.length >= total) break;
    }
    if (!added) break;
  }

  return { items: shuffle(items), ok, failed };
}
