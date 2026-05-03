export interface BlogPost {
  id: string;
  title: string;
  titleAr: string;
  slug: string;
  description: string;
  descriptionAr: string;
  content: string;
  contentAr: string;
  date: string;
}

const mockPosts: BlogPost[] = [
  {
    id: '1',
    title: 'Designing a calmer smart home experience',
    titleAr: 'تصميم تجربة منزل ذكي أكثر هدوءاً',
    slug: 'calmer-smart-home-experience',
    description: 'How Alma keeps connected-home controls focused, fast, and easy to trust.',
    descriptionAr: 'كيف يجعل ألما التحكم بالمنزل المتصل أكثر تركيزاً وسرعة وسهولة في الثقة.',
    date: '2026-04-24',
    content:
      'Smart home products work best when they stay out of the way. Alma is designed around clear device states, fast room navigation, and secure control paths that make everyday interactions feel dependable.',
    contentAr:
      'تعمل منتجات المنزل الذكي بأفضل شكل عندما تبقى بسيطة وغير مزعجة. صمم ألما حول حالات أجهزة واضحة وتنقل سريع بين الغرف ومسارات تحكم آمنة تجعل التفاعل اليومي أكثر اعتماداً.',
  },
  {
    id: '2',
    title: 'What matters in smart building notifications',
    titleAr: 'ما الذي يهم في تنبيهات المباني الذكية',
    slug: 'smart-building-notifications',
    description: 'A practical look at alerts that are timely, useful, and never noisy.',
    descriptionAr: 'نظرة عملية على التنبيهات التي تصل في الوقت المناسب وتبقى مفيدة دون إزعاج.',
    date: '2026-04-18',
    content:
      'Notifications should help people act with confidence. Future Alma updates will focus on priority signals, room context, and alert history so users can understand what changed and why it matters.',
    contentAr:
      'ينبغي أن تساعد التنبيهات المستخدمين على التصرف بثقة. ستركز تحديثات ألما القادمة على الإشارات المهمة وسياق الغرف وسجل التنبيهات حتى يفهم المستخدم ما تغير ولماذا يهم.',
  },
  {
    id: '3',
    title: 'Preparing connected devices for better onboarding',
    titleAr: 'تهيئة الأجهزة المتصلة لتجربة بدء أفضل',
    slug: 'connected-device-onboarding',
    description: 'Pairing flows should be guided, recoverable, and friendly to real homes.',
    descriptionAr: 'ينبغي أن تكون تجربة الاقتران موجهة وسهلة الاستعادة ومناسبة للمنازل الواقعية.',
    date: '2026-04-10',
    content:
      'Device onboarding is one of the most important moments in a smart home product. Alma aims to make pairing clearer by presenting simple steps, helpful feedback, and room organization from the start.',
    contentAr:
      'تعد تهيئة الأجهزة من أهم اللحظات في أي منتج منزل ذكي. يهدف ألما إلى جعل الاقتران أوضح عبر خطوات بسيطة وملاحظات مفيدة وتنظيم الغرف منذ البداية.',
  },
];

export async function getPosts() {
  return mockPosts;
}

export async function getPostBySlug(slug: string) {
  return mockPosts.find((post) => post.slug === slug) ?? null;
}
