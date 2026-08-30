/**
 * Storefront policy pages (refund / shipping / privacy), AR-first.
 * Merchants override via stores.settings.policies.{type}_ar / {type}_en;
 * these defaults render whenever a field is unset so every store has
 * complete policies from day one.
 */

export const POLICY_TYPES = ["refund", "shipping", "privacy"] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const POLICY_TITLES: Record<PolicyType, string> = {
  refund: "سياسة الاسترجاع والاستبدال",
  shipping: "سياسة الشحن والتوصيل",
  privacy: "سياسة الخصوصية",
};

const DEFAULT_BODIES: Record<PolicyType, string> = {
  refund: `يحق لك طلب استرجاع أو استبدال المنتج خلال 14 يومًا من الاستلام بشرط أن يكون بحالته الأصلية وبدون استخدام.

للبدء في طلب الاسترجاع تواصل معنا برقم الطلب عبر الواتساب أو الهاتف، وسنرد عليك خلال يوم عمل.

في حالة وجود عيب مصنعي يتم الاستبدال أو رد المبلغ كاملًا دون تحملك أي مصاريف شحن. في الحالات الأخرى قد يتحمل العميل مصاريف شحن الإرجاع.

المبالغ المدفوعة نقدًا عند الاستلام يتم ردها تحويلًا خلال 7 أيام عمل من وصول المنتج المرتجع وفحصه.`,
  shipping: `نوصّل لجميع محافظات مصر عن طريق شركات شحن موثوقة، والدفع عند الاستلام.

مدة التوصيل المعتادة من 2 إلى 5 أيام عمل حسب المحافظة، وقد تزيد في المناطق البعيدة أو مواسم الضغط.

رسوم الشحن تظهر بوضوح قبل تأكيد الطلب. يرجى التأكد من صحة العنوان ورقم الموبايل — سيتواصل معك المندوب قبل التسليم.

في حالة تعذر التسليم بعد محاولتين سيتم إلغاء الطلب تلقائيًا.`,
  privacy: `نحترم خصوصيتك: نجمع فقط البيانات اللازمة لتنفيذ طلبك — الاسم، رقم الموبايل، والعنوان.

نستخدم رقم موبايلك للتواصل بخصوص تأكيد الطلب والتوصيل (مكالمات أو رسائل واتساب)، ولا نشاركه مع أي طرف ثالث باستثناء شركة الشحن المسؤولة عن توصيل طلبك.

لا نخزّن أي بيانات دفع إلكتروني — الدفع كاش عند الاستلام.

يمكنك طلب حذف بياناتك في أي وقت بالتواصل معنا.`,
};

export interface PolicySettings {
  [key: string]: unknown;
}

/**
 * Resolve one policy page from the store's settings.policies jsonb, falling
 * back to the defaults. `lang` picks the merchant's optional _en override
 * (P11 storefront toggle); AR is always the fallback.
 */
export function getPolicyPage(
  policies: PolicySettings | null | undefined,
  type: PolicyType,
  lang: "ar" | "en" = "ar",
): { title: string; body: string } {
  const pick = (key: string): string | null => {
    const v = policies?.[key];
    return typeof v === "string" && v.trim().length > 0 ? v : null;
  };
  const body =
    (lang === "en" ? pick(`${type}_en`) : null) ?? pick(`${type}_ar`) ?? DEFAULT_BODIES[type];
  return { title: POLICY_TITLES[type], body };
}
