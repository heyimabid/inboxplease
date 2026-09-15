import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Clock3,
  Heart,
  Menu,
  MessageCircle,
  Package,
  Play,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  UserRound,
  X,
} from 'lucide-react';
import { launchPlans, recommendedPlan } from '../../shared/pricing';
import '../styles/landing.css';

type Language = 'bn' | 'en';
const copy = {
  bn: {
    nav: ['কী কী পাবেন', 'যেভাবে কাজ করে', 'খরচ', 'সাধারণ প্রশ্ন'],
    login: 'লগইন',
    start: 'আমার দোকান খুলব',
    demo: 'একটু দেখে নিই',
    badge: 'বাংলাদেশের ফেসবুক দোকানের জন্য',
    headline: 'ইনবক্সের ব্যস্ততা কমুক।',
    highlight: 'বিক্রিতে মন দিন।',
    intro:
      '“দাম কত?” থেকে “অর্ডার করব”—কাস্টমারের প্রশ্নের উত্তর, পণ্যের ছবি আর অর্ডারের তথ্য সামলাতে পাশে আছে inboxplease।',
    heroNote: 'আপনার পণ্য। আপনার দেওয়া দাম। আপনার নিয়ন্ত্রণ।',
    demoLabel: 'এভাবেই হতে পারে আপনার দোকানের কথোপকথন',
    sample: 'নমুনা কথোপকথন',
    shop: 'রঙের দোকান',
    assistant: 'আপনার দোকানের সহকারী',
    demos: ['দাম জানতে চাই', 'ডেলিভারি জানতে চাই', 'অর্ডার করতে চাই'],
    customer: ['ei bag tar dam koto?', 'Dhakar baire delivery hobe?', 'accha ekta nibo, COD hobe?'],
    answers: [
      'এই টোট ব্যাগটি ৬৫০ টাকা। ন্যাচারাল রঙটি আছে। একটু কাছে থেকে ছবি দেখাব?',
      'জি, ঢাকার বাইরেও পাঠানো হয়। এই নমুনা দোকানে ডেলিভারি চার্জ ১৩০ টাকা। কোন জেলায় পাঠাব?',
      'জি, হাতে পেয়ে দাম দিতে পারবেন। ১টি ব্যাগ রাখছি। কোন নামে আর কোথায় পাঠাব?',
    ],
    product: 'প্রতিদিনের টোট ব্যাগ',
    color: 'ন্যাচারাল · ক্যানভাস',
    price: '৳৬৫০',
    saved: 'কথা থেকে অর্ডারের তথ্য',
    savedNote: 'নাম, ফোন, ঠিকানা—এক জায়গায়',
    demoHint: 'একটি প্রশ্ন বেছে দেখুন',
    sampleNote: 'উদাহরণের পণ্য ও দাম। আপনার দোকানে আপনার দেওয়া তথ্য ব্যবহার হবে।',
    strip: ['বাংলা, English ও Banglish', 'মোবাইল থেকেই পরিচালনা', 'যখন খুশি নিজে উত্তর দিন'],
    featureEyebrow: 'আপনার প্রতিদিনের কাজ, একটু সহজ',
    featureTitle: 'একই উত্তর বারবার? এবার একটু বিরতি।',
    featureIntro:
      'ব্যস্ত হাতে প্যাকিং করুন। পরিচিত প্রশ্নগুলো সামলাতে আপনার দোকানের সহকারীকে পাশে রাখুন।',
    features: [
      [
        'কাস্টমার যেভাবে বলেন, সেভাবেই কথা',
        'বাংলা, ইংরেজি বা “price koto”—কথার মানে বুঝে আপনার দেওয়া তথ্য থেকে উত্তর দিতে সাহায্য করে।',
      ],
      [
        'সঠিক পণ্যের তথ্য, ছবিসহ',
        'দাম, স্টক, রঙ ও সাইজ জানায়। আপনার রাখা ছবি দেখায়; কাস্টমারের ছবির সঙ্গে মিল নিশ্চিত না হলে সেটাও বলে।',
      ],
      [
        'অর্ডারের তথ্য আর ছড়িয়ে থাকে না',
        'নাম, ফোন, ঠিকানা ও পছন্দের পণ্য এক জায়গায় রাখে। কাস্টমার সব দেখে সম্মতি দিলে অর্ডার নিশ্চিত হয়।',
      ],
      [
        'কথোপকথনের হাল আপনার হাতেই',
        'বিশেষ কোনো প্রশ্ন? যেকোনো সময় নিজে কথা বলুন। চাইলে সহকারীর উত্তর বন্ধ বা আবার চালু করুন।',
      ],
    ],
    howEyebrow: 'কঠিন কিছু শিখতে হবে না',
    howTitle: 'আপনার দোকান, মাত্র তিন ধাপে।',
    steps: [
      [
        'ফেসবুক পেজ যুক্ত করুন',
        'ফেসবুক দিয়ে লগইন করে যে পেজে বিক্রি করেন, সেটি বেছে নিন। অনুমতি দেবেন আপনি।',
      ],
      ['পণ্যের তথ্য দিন', 'ছবি, দাম, স্টক, ডেলিভারি চার্জ ও দোকানের নিয়ম যোগ করুন।'],
      [
        'উত্তর দেওয়া চালু করুন',
        'তথ্য দেখে প্রস্তুত হলে সহকারী চালু করুন। মেসেজ আর অর্ডার দেখুন একই জায়গায়।',
      ],
    ],
    controlTitle: 'দোকান আপনার। শেষ কথা আপনারই।',
    controlText:
      'সহকারীকে চালু করার সিদ্ধান্ত আপনার। তথ্য বদলালে দোকানেও আপডেট করুন, আর গুরুত্বপূর্ণ অর্ডার দেখে নিন। সহকারীও ভুল করতে পারে।',
    controlLink: 'তথ্য ও অনুমতি সম্পর্কে জানুন',
    pricingEyebrow: 'খরচটা আগে থেকেই বুঝে নিন',
    pricingTitle: 'ছোট করে শুরু। দোকানের সঙ্গে বড় হোন।',
    pricingIntro:
      'মাসিক খরচ টাকায়। প্রতিটি প্ল্যানে প্রশ্নের উত্তর, পণ্যের ছবি, অর্ডারের তথ্য ও নিজে কথা বলার সুবিধা।',
    launch: 'প্রস্তাবিত লঞ্চ মূল্য',
    month: '/ মাস',
    planNames: ['শুরু', 'এগিয়ে চলা', 'ব্যবসা'],
    planNotes: [
      'ছোট ইনবক্স, ছোট বাজেট',
      'নিয়মিত মেসেজ আসে যে দোকানে',
      'একাধিক পেজ, আরও বেশি মেসেজ',
    ],
    featured: 'বাড়তে থাকা দোকানের জন্য',
    replies: 'সহকারীর উত্তর / মাস',
    pages: 'ফেসবুক পেজ',
    products: 'পণ্য পর্যন্ত',
    photos: 'কাস্টমারের ছবি যাচাই / মাস',
    planCta: 'এই প্ল্যান দিয়ে শুরু',
    sharedFeature: 'সব মূল সুবিধা অন্তর্ভুক্ত',
    billingNotice:
      'এখন কোনো পেমেন্ট নেওয়া হচ্ছে না। এগুলো প্রস্তাবিত প্ল্যান; সেবা চালুর আগে মূল্য ও ব্যবহারের সীমা নিশ্চিত করা হবে। অ্যাকাউন্ট খুললেই কোনো প্ল্যান কেনা হয় না।',
    countTitle: 'একটি উত্তর কীভাবে গোনা হবে?',
    countText:
      'কাস্টমারের একটি প্রশ্নের জবাবে সহকারীর পাঠানো উত্তর = ১টি। একই উত্তরের পণ্যের ছবি আলাদা উত্তর নয়। আপনার নিজের লেখা মেসেজ গোনা হবে না। এটি প্রস্তাবিত হিসাব।',
    estimateTitle: 'কোন প্ল্যানটি আপনার জন্য?',
    estimateLabel: 'দিনে আনুমানিক কতটি উত্তর দিতে হবে?',
    perDay: 'টি / দিন',
    monthly: 'মাসে প্রায়',
    replyUnit: 'টি উত্তর',
    recommendation: 'দেখতে পারেন',
    custom: 'বেশি ব্যবহারের জন্য আলাদা প্ল্যান প্রয়োজন',
    estimateNote: '৩০ দিনের আনুমানিক হিসাব। একটি অর্ডার নিতে কয়েকটি উত্তর লাগতে পারে।',
    faqEyebrow: 'ভাবছেন হয়তো…',
    faqTitle: 'শুরু করার আগে যা জানতে চান।',
    faqs: [
      [
        'আমার কি কোনো টেকনিক্যাল জ্ঞান লাগবে?',
        'না। ফেসবুক দিয়ে লগইন করুন, পেজ বেছে নিন আর পণ্যের তথ্য দিন। কোড লেখা বা আলাদা সফটওয়্যার লাগবে না।',
      ],
      [
        'এটা কি আমার হয়ে নিজে থেকেই সব চালু করে দেবে?',
        'না। লগইন, পেজ যুক্ত করা ও সহকারীর উত্তর চালু করা আলাদা ধাপ। কোন পেজে কাজ করবে আর কখন উত্তর দেবে, তা আপনি ঠিক করবেন।',
      ],
      [
        'কাস্টমার বাংলা বা Banglish লিখলে বুঝবে?',
        'সহকারী বাংলা, English ও Banglish-এ কথার মানে বুঝে উত্তর দিতে পারে। অস্পষ্ট প্রশ্নে আবার জানতে চাইতে পারে। গুরুত্বপূর্ণ তথ্য ও অর্ডার দেখে নেওয়া ভালো।',
      ],
      [
        'ক্যাশ অন ডেলিভারি আর এলাকার চার্জ জানাতে পারবে?',
        'আপনার দোকানে যে নিয়ম ও ডেলিভারি চার্জ যোগ করবেন, তা জানাতে পারবে। নিজে পেমেন্ট সংগ্রহ বা কুরিয়ার বুকিং করে না।',
      ],
      [
        'মাসের উত্তর শেষ হলে কী হবে?',
        'পেইড প্ল্যান এখনো চালু হয়নি। প্রস্তাবিত নিয়ম হলো: সীমা শেষ হলে বাড়তি খরচে উত্তর চালানোর আগে আপনার সম্মতি নেওয়া হবে। কোনো স্বয়ংক্রিয় বাড়তি বিলের প্রতিশ্রুতি বা চার্জ এখন নেই।',
      ],
      [
        'এখনই কি বিকাশ বা নগদে টাকা দিতে হবে?',
        'না, এখন কোনো পেমেন্ট নেওয়া হচ্ছে না। বিকাশ, নগদ বা কার্ডে পেমেন্ট এখনো যুক্ত হয়নি। পেইড সেবা চালু হলে পদ্ধতি, চূড়ান্ত মূল্য ও নিয়ম আগে জানানো হবে।',
      ],
      [
        'আমি কি মাঝখানে নিজে কথা বলতে পারব?',
        'অবশ্যই। ইনবক্স থেকে নিজে উত্তর দিতে পারবেন। তখন সহকারীর স্বয়ংক্রিয় উত্তর থেমে যাবে; চাইলে পরে আবার চালু করতে পারবেন।',
      ],
    ],
    privacyTitle: 'আপনার তথ্য ও অনুমতি',
    privacyText:
      'লগইনে ফেসবুকের নাম ও প্রোফাইল ব্যবহার হয়। পেজের মেসেজ সামলানোর অনুমতি আলাদাভাবে দিতে হয়। উত্তর ও অর্ডার সামলাতে পণ্য, মেসেজ এবং কাস্টমারের দেওয়া তথ্য সংরক্ষণ ও প্রক্রিয়া করা হয়; স্বয়ংক্রিয় উত্তর তৈরিতে Google ও Cloudflare-এর সেবা ব্যবহৃত হয়। Settings থেকে পেজ বিচ্ছিন্ন করতে পারবেন।',
    finalTitle: 'আপনি দোকানটা বড় করুন।',
    finalHighlight: 'ইনবক্সে পাশে থাকি আমরা।',
    finalText: 'আপনার পেজ আর পণ্যের তথ্য দিয়ে শুরু করুন।',
    footerText: 'দোকানের গল্প হোক, ভালো কথোপকথন থেকে।',
    made: 'বাংলাদেশের বিক্রেতাদের কথা ভেবে।',
    permission: 'তথ্য ও অনুমতি',
    top: 'উপরে যান',
    skip: 'মূল অংশে যান',
    menu: 'মেনু',
  },
  en: {
    nav: ['Features', 'How it works', 'Pricing', 'FAQs'],
    login: 'Log in',
    start: 'Set up my shop',
    demo: 'See it in action',
    badge: 'FOR FACEBOOK SHOPS IN BANGLADESH',
    headline: 'Less inbox busywork.',
    highlight: 'More room to sell.',
    intro:
      'From “price koto?” to “I’ll take one”—get a little help with customer questions, product photos and order details.',
    heroNote: 'Your products. Your prices. You’re in control.',
    demoLabel: 'A little preview of your shop’s conversations',
    sample: 'Sample conversation',
    shop: 'Ronger Dokan',
    assistant: 'Your shop’s assistant',
    demos: ['Ask the price', 'Ask about delivery', 'Place an order'],
    customer: [
      'How much is this bag?',
      'Do you deliver outside Dhaka?',
      'I’ll take one. Can I pay on delivery?',
    ],
    answers: [
      'This tote is ৳650, and the natural colour is available. Would you like a closer look?',
      'Yes! This sample shop delivers outside Dhaka for ৳130. Which district should we send it to?',
      'Yes, you can pay when it arrives. One bag it is! What name and delivery address should I use?',
    ],
    product: 'The everyday tote',
    color: 'Natural · Canvas',
    price: '৳650',
    saved: 'From conversation to order details',
    savedNote: 'Name, phone, address—all together',
    demoHint: 'Choose a question to try',
    sampleNote: 'Illustrative product and prices. Your shop uses the information you provide.',
    strip: ['Bangla, English & Banglish', 'Manage from your phone', 'Step in whenever you like'],
    featureEyebrow: 'A LITTLE HELP WITH YOUR EVERYDAY',
    featureTitle: 'Same questions. A little less typing.',
    featureIntro:
      'Keep packing those parcels. Let your shop’s assistant lend a hand with the familiar questions.',
    features: [
      [
        'Speaks the way your customers do',
        'Bangla, English or “price koto”—it understands the conversation and helps answer using your shop’s information.',
      ],
      [
        'Product details, with the pictures',
        'Share prices, stock, colours, sizes and your product photos. If a customer photo isn’t a confirmed match, it says so.',
      ],
      [
        'Order details stay together',
        'Keep the name, phone, address and selected products in one place. The customer reviews and approves before an order is confirmed.',
      ],
      [
        'You always have the last word',
        'A question needs your attention? Join the conversation at any time. Pause the assistant and switch it back on when you’re ready.',
      ],
    ],
    howEyebrow: 'NO TECH SKILLS NEEDED',
    howTitle: 'Your shop. Three simple steps.',
    steps: [
      [
        'Connect your Facebook Page',
        'Sign in with Facebook and choose the Page you sell from. You decide which permissions to give.',
      ],
      [
        'Add your shop’s details',
        'Upload products, photos, prices, stock, delivery charges and your shop’s policies.',
      ],
      [
        'Let the conversations begin',
        'Review your details and turn on your assistant. Find messages and orders in the same place.',
      ],
    ],
    controlTitle: 'Your shop. Your say. Always.',
    controlText:
      'You choose when to turn the assistant on. Keep your shop details up to date and review important orders. Your assistant can make mistakes, too.',
    controlLink: 'About your information and permissions',
    pricingEyebrow: 'KNOW THE COST BEFORE YOU START',
    pricingTitle: 'Start small. Grow at your own pace.',
    pricingIntro:
      'Monthly prices in taka. Every plan includes answers, product photos, order details and the freedom to step in.',
    launch: 'Proposed launch pricing',
    month: '/ month',
    planNames: ['Starter', 'Growth', 'Business'],
    planNotes: [
      'A small inbox, a smaller budget',
      'For shops with regular messages',
      'More Pages, more conversations',
    ],
    featured: 'FOR A GROWING SHOP',
    replies: 'assistant replies / month',
    pages: 'Facebook Page(s)',
    products: 'products',
    photos: 'customer photo checks / month',
    planCta: 'Get started',
    sharedFeature: 'All core features included',
    billingNotice:
      'No payments are collected yet. These are proposed plans; prices and limits will be confirmed before paid service starts. Creating an account does not purchase a plan.',
    countTitle: 'What counts as one reply?',
    countText:
      'One assistant answer to a customer question counts as one reply. Product photos sent with that answer don’t count separately. Your own messages don’t count. This is the proposed counting policy.',
    estimateTitle: 'Find your starting point',
    estimateLabel: 'About how many replies do you need each day?',
    perDay: '/ day',
    monthly: 'Around',
    replyUnit: 'replies a month',
    recommendation: 'Take a look at',
    custom: 'You’ll need a larger, tailored plan',
    estimateNote: 'An estimate based on 30 days. One order may take several replies.',
    faqEyebrow: 'A FEW THINGS YOU MIGHT BE WONDERING',
    faqTitle: 'Good questions. Straight answers.',
    faqs: [
      [
        'Do I need to know anything technical?',
        'No. Sign in with Facebook, choose your Page and add your products. There’s no code to write or separate software to install.',
      ],
      [
        'Does signing in turn on automatic replies?',
        'No. Signing in, connecting a Page and enabling the assistant are separate steps. You choose where and when it replies.',
      ],
      [
        'Does it understand Bangla and Banglish?',
        'The assistant can interpret and reply in Bangla, English and Banglish. It may ask for clarification when something is unclear. Review important details and orders.',
      ],
      [
        'Can it explain cash on delivery and delivery charges?',
        'It can explain the rules and area charges you add to your shop. It does not collect payments or book couriers.',
      ],
      [
        'What happens when my replies run out?',
        'Paid plans are not active yet. The proposed policy is to ask for your agreement before adding paid usage. No automatic overage billing is active.',
      ],
      [
        'Do I need to pay with bKash or Nagad now?',
        'No payments are collected yet. bKash, Nagad and card checkout are not connected. Payment options, final prices and terms will be explained before paid service starts.',
      ],
      [
        'Can I take over a conversation?',
        'Absolutely. Reply personally from your inbox. Automatic replies pause while you take over, and you can resume the assistant later.',
      ],
    ],
    privacyTitle: 'Your information and permissions',
    privacyText:
      'Facebook sign-in uses your name and profile. Permission to manage Page messages is requested separately. Products, messages and customer-provided details are stored and processed to handle replies and orders; automated replies use Google and Cloudflare services. You can disconnect a Page in Settings.',
    finalTitle: 'Keep growing your shop.',
    finalHighlight: 'We’ll lend a hand in the inbox.',
    finalText: 'Start with your Page and the products you already sell.',
    footerText: 'Good conversations. A little more room to grow.',
    made: 'Made with Bangladesh’s sellers in mind.',
    permission: 'Information & permissions',
    top: 'Back to top',
    skip: 'Skip to content',
    menu: 'Menu',
  },
} as const;

export function LandingPage() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem('inboxplease.language') === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  });
  const [menu, setMenu] = useState(false);
  const [demo, setDemo] = useState(0);
  const [daily, setDaily] = useState(20);
  const t = copy[language];
  const number = (n: number) =>
    new Intl.NumberFormat(language === 'bn' ? 'bn-BD' : 'en-BD').format(n);
  const plan = recommendedPlan(daily * 30);
  const planIndex = launchPlans.findIndex((p) => p.id === plan?.id);
  const signup = `/login?lang=${language}`;
  useEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === 'bn'
        ? 'inboxplease — ইনবক্স সামলান, বিক্রিতে মন দিন'
        : 'inboxplease — A little help for your Facebook shop';
    try {
      localStorage.setItem('inboxplease.language', language);
    } catch {
      /* Storage is optional. */
    }
    return () => {
      document.documentElement.lang = 'en';
    };
  }, [language]);
  const anchors = ['features', 'how-it-works', 'pricing', 'faq'];
  return (
    <div className="landing" lang={language} id="top">
      <a href="#main" className="lp-skip">
        {t.skip}
      </a>
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <a href="#top" className="lp-brand" aria-label="inboxplease home">
            <span>
              <MessageCircle size={23} />
            </span>
            inboxplease<i>.</i>
          </a>
          <nav className={menu ? 'lp-nav is-open' : 'lp-nav'} id="landing-nav" aria-label={t.menu}>
            {anchors.map((id, i) => (
              <a href={`#${id}`} key={id} onClick={() => setMenu(false)}>
                {t.nav[i]}
              </a>
            ))}
          </nav>
          <div className="lp-header-actions">
            <div className="lp-languages" aria-label="Language">
              <button
                type="button"
                lang="bn"
                aria-pressed={language === 'bn'}
                onClick={() => setLanguage('bn')}
              >
                বাংলা
              </button>
              <button
                type="button"
                lang="en"
                aria-pressed={language === 'en'}
                onClick={() => setLanguage('en')}
              >
                EN
              </button>
            </div>
            <Link className="lp-login" to={signup}>
              {t.login}
              <ArrowUpRight size={16} />
            </Link>
            <button
              className="lp-menu"
              aria-label={t.menu}
              aria-controls="landing-nav"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="lp-container lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow lp-badge">
              <span className="lp-live-dot" />
              {t.badge}
            </span>
            <h1>
              {t.headline}
              <br />
              <span>
                {t.highlight}
                <svg viewBox="0 0 360 15" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M3 10 Q160 -2 357 8 M30 14 Q190 6 324 13" />
                </svg>
              </span>
            </h1>
            <p>{t.intro}</p>
            <div className="lp-hero-actions">
              <Link className="lp-button lp-primary" to={signup}>
                {t.start}
                <ArrowUpRight size={19} />
              </Link>
              <a className="lp-demo-link" href="#demo">
                <span>
                  <Play size={14} />
                </span>
                {t.demo}
              </a>
            </div>
            <div className="lp-hero-note">
              <ShieldCheck size={17} />
              {t.heroNote}
            </div>
          </div>
          <div className="lp-demo-stage" id="demo" aria-label={t.demoLabel}>
            <span className="lp-demo-caption">
              {t.sample}
              <ArrowDown size={15} />
            </span>
            <div className="lp-chat">
              <div className="lp-chat-header">
                <span className="lp-shop-icon">
                  <ShoppingBag size={23} />
                </span>
                <div>
                  <strong>{t.shop}</strong>
                  <span>
                    <span className="lp-live-dot" />
                    {t.assistant}
                  </span>
                </div>
                <MessageCircle size={20} />
              </div>
              <div className="lp-chat-body" aria-live="polite" aria-atomic="true">
                <span className="lp-chat-date">{language === 'bn' ? 'আজ' : 'Today'} · 10:24</span>
                <div className="lp-bubble lp-customer" key={`q-${language}-${demo}`}>
                  {t.customer[demo]}
                </div>
                <div className="lp-chat-product">
                  <div className="lp-tote" aria-hidden="true">
                    <div className="lp-tote-handle" />
                    <span>
                      <span>রং</span>
                      <small>everyday things</small>
                    </span>
                  </div>
                  <div>
                    <strong>{t.product}</strong>
                    <span>{t.color}</span>
                    <b>{t.price}</b>
                  </div>
                </div>
                <div className="lp-bubble lp-assistant" key={`a-${language}-${demo}`}>
                  {t.answers[demo]}
                </div>
                <span className="lp-chat-sent">
                  <Sparkles size={11} /> inboxplease <CheckCheck size={14} />
                </span>
              </div>
              <div className="lp-chat-choices">
                <span>{t.demoHint}</span>
                <div>
                  {t.demos.map((label, i) => (
                    <button key={i} aria-pressed={demo === i} onClick={() => setDemo(i)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="lp-order-note">
              <span>
                <CircleCheck size={23} />
              </span>
              <div>
                <strong>{t.saved}</strong>
                <small>{t.savedNote}</small>
              </div>
            </div>
            <p className="lp-sample-note">{t.sampleNote}</p>
          </div>
        </section>
        <div className="lp-value-strip">
          <div className="lp-container">
            {[MessageCircle, Store, UserRound].map((Icon, i) => (
              <span key={i}>
                <Icon size={20} />
                {t.strip[i]}
              </span>
            ))}
          </div>
        </div>
        <section className="lp-container lp-section" id="features">
          <div className="lp-section-heading">
            <span className="lp-eyebrow">{t.featureEyebrow}</span>
            <h2>{t.featureTitle}</h2>
            <p>{t.featureIntro}</p>
          </div>
          <div className="lp-features">
            {[MessageCircle, Package, ShoppingBag, UserRound].map((Icon, i) => (
              <article key={i}>
                <span className={`lp-feature-icon icon-${i}`}>
                  <Icon size={26} />
                </span>
                <span className="lp-feature-number">0{i + 1}</span>
                <h3>{t.features[i]![0]}</h3>
                <p>{t.features[i]![1]}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="lp-how" id="how-it-works">
          <div className="lp-container lp-section">
            <div className="lp-section-heading">
              <span className="lp-eyebrow">{t.howEyebrow}</span>
              <h2>{t.howTitle}</h2>
            </div>
            <div className="lp-steps">
              {[Store, Package, MessageCircle].map((Icon, i) => (
                <article key={i}>
                  <div>
                    <span className="lp-step-number">{number(i + 1)}</span>
                    <Icon size={28} />
                  </div>
                  <h3>{t.steps[i]![0]}</h3>
                  <p>{t.steps[i]![1]}</p>
                </article>
              ))}
            </div>
            <div className="lp-control">
              <ShieldCheck size={35} />
              <div>
                <h3>{t.controlTitle}</h3>
                <p>{t.controlText}</p>
              </div>
              <a href="#information">
                {t.controlLink}
                <ArrowUpRight size={17} />
              </a>
            </div>
          </div>
        </section>
        <section className="lp-container lp-section lp-pricing" id="pricing">
          <div className="lp-section-heading">
            <span className="lp-eyebrow">{t.pricingEyebrow}</span>
            <h2>{t.pricingTitle}</h2>
            <p>{t.pricingIntro}</p>
            <span className="lp-launch">
              <Clock3 size={14} />
              {t.launch}
            </span>
          </div>
          <div className="lp-plans">
            {launchPlans.map((p, i) => (
              <article key={p.id} className={`lp-plan ${i === 1 ? 'lp-plan-featured' : ''}`}>
                {i === 1 && (
                  <div className="lp-plan-ribbon">
                    <Sparkles size={13} />
                    {t.featured}
                  </div>
                )}
                <h3>{t.planNames[i]}</h3>
                <p>{t.planNotes[i]}</p>
                <div className="lp-price">
                  <strong>
                    <span>৳</span>
                    {number(p.priceBdt)}
                  </strong>
                  <span>{t.month}</span>
                </div>
                <div className="lp-reply-count">
                  <MessageCircle size={17} />
                  <strong>{number(p.replies)}</strong> {t.replies}
                </div>
                <ul>
                  {[
                    [p.pages, t.pages],
                    [p.products, t.products],
                    [p.photoChecks, t.photos],
                  ].map(([n, label]) => (
                    <li key={String(label)}>
                      <Check size={16} />
                      <span>
                        {number(Number(n))} {label}
                      </span>
                    </li>
                  ))}
                  <li>
                    <Check size={16} />
                    <span>{t.sharedFeature}</span>
                  </li>
                </ul>
                <Link
                  to={`${signup}&plan=${p.id}`}
                  className={`lp-button ${i === 1 ? 'lp-primary' : 'lp-outline'}`}
                  aria-label={`${t.planCta} — ${t.planNames[i]}`}
                >
                  {t.planCta}
                  <ArrowRight size={17} />
                </Link>
              </article>
            ))}
          </div>
          <p className="lp-billing-notice">{t.billingNotice}</p>
          <div className="lp-pricing-explainer">
            <div>
              <h3>{t.countTitle}</h3>
              <p>{t.countText}</p>
            </div>
            <div className="lp-estimator">
              <h3>{t.estimateTitle}</h3>
              <label htmlFor="daily-replies">{t.estimateLabel}</label>
              <div className="lp-range">
                <input
                  id="daily-replies"
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={daily}
                  onChange={(e) => setDaily(Number(e.target.value))}
                  aria-valuetext={`${number(daily)} ${t.perDay}`}
                />
                <output htmlFor="daily-replies">
                  {number(daily)} <span>{t.perDay}</span>
                </output>
              </div>
              <p aria-live="polite">
                {t.monthly} <strong>{number(daily * 30)}</strong> {t.replyUnit} ·{' '}
                {plan ? (
                  <>
                    {t.recommendation} <a href="#pricing">{t.planNames[planIndex]}</a>
                  </>
                ) : (
                  t.custom
                )}
              </p>
              <small>{t.estimateNote}</small>
            </div>
          </div>
        </section>
        <section className="lp-faq-section" id="faq">
          <div className="lp-container lp-section lp-faq-grid">
            <div className="lp-section-heading">
              <span className="lp-eyebrow">{t.faqEyebrow}</span>
              <h2>{t.faqTitle}</h2>
              <MessageCircle className="lp-faq-doodle" size={68} strokeWidth={1} />
            </div>
            <div className="lp-faqs">
              {t.faqs.map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    {question}
                    <ChevronDown size={18} />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-container lp-information" id="information">
          <ShieldCheck size={24} />
          <div>
            <h3>{t.privacyTitle}</h3>
            <p>{t.privacyText}</p>
          </div>
        </section>
        <section className="lp-container lp-final">
          <div>
            <span className="lp-eyebrow">INBOXPLEASE, PLEASE.</span>
            <h2>
              {t.finalTitle}
              <br />
              <span>{t.finalHighlight}</span>
            </h2>
            <p>{t.finalText}</p>
          </div>
          <Link className="lp-button" to={signup}>
            {t.start}
            <ArrowUpRight size={20} />
          </Link>
          <span className="lp-final-decoration" aria-hidden="true">
            <MessageCircle size={180} strokeWidth={1} />
          </span>
        </section>
      </main>
      <footer className="lp-container lp-footer">
        <div className="lp-footer-top">
          <div>
            <a href="#top" className="lp-brand">
              <span>
                <MessageCircle size={21} />
              </span>
              inboxplease<i>.</i>
            </a>
            <p>{t.footerText}</p>
          </div>
          <nav aria-label={language === 'bn' ? 'ফুটার' : 'Footer'}>
            <a href="#pricing">{t.nav[2]}</a>
            <a href="#faq">{t.nav[3]}</a>
            <a href="#information">{t.permission}</a>
            <Link to={signup}>
              {t.login}
              <ArrowUpRight size={14} />
            </Link>
          </nav>
        </div>
        <div className="lp-footer-bottom">
          <span>© {new Date().getFullYear()} inboxplease.</span>
          <span>
            <Heart size={13} />
            {t.made}
          </span>
          <a href="#top">{t.top} ↑</a>
        </div>
      </footer>
    </div>
  );
}
