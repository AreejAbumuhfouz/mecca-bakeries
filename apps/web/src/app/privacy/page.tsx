import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — مخابز مكة',
  description: 'كيف يتعامل نظام وتطبيق مخابز مكة مع بيانات المستخدمين',
};

// Filled per deployment, so the page names the right owner and contact.
const OWNER = process.env.NEXT_PUBLIC_OWNER_NAME || 'شركة مالك عيال عواد وشركاه (مخابز مكة)';
const EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL || '';
const PHONE = process.env.NEXT_PUBLIC_PRIVACY_PHONE || '';
const UPDATED = '2026-12-01';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-bold text-brand-brown">{title}</h2>
    <div className="space-y-2 leading-8 text-ink">{children}</div>
  </section>
);

/** Public page; the app stores link to it. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-1 border-b border-brand-line pb-4">
        <h1 className="text-2xl font-bold text-brand-brown">سياسة الخصوصية</h1>
        <p className="text-sm text-brand-muted">
          لنظام مخابز مكة (لوحة التحكم وتطبيق الجوال) — آخر تحديث {UPDATED}
        </p>
      </header>

      <Section title="من نحن">
        <p>
          النظام والتطبيق مملوكان لـ {OWNER}، ويُستخدمان لإدارة طلبات الخبز والمعجنات من المطاعم
          والعملاء، وتوزيعها، وإصدار فواتيرها وتحصيلها. الحسابات يُنشئها المخبز لعملائه وموظفيه؛ لا
          يمكن لأي شخص التسجيل بنفسه.
        </p>
      </Section>

      <Section title="البيانات التي نجمعها">
        <ul className="list-disc space-y-1 pe-6">
          <li>بيانات الحساب: الاسم، البريد الإلكتروني، والدور (مطعم، سائق، موظف).</li>
          <li>بيانات العميل: اسم المطعم وفروعه، أرقام الهاتف، العناوين، وشروط العقد.</li>
          <li>الطلبات والفواتير والمدفوعات وكشوف الحساب.</li>
          <li>
            للسائقين فقط: الموقع الجغرافي <b>لحظة تأكيد التسليم فقط</b>، واسم المستلم أو توقيعه. لا
            يتتبع التطبيق موقع السائق في أي وقت آخر ولا في الخلفية.
          </li>
          <li>رمز الإشعارات للجهاز (لإرسال تذكير الطلب وتحديثاته).</li>
          <li>سجلات تقنية: عنوان IP ووقت العمليات، لحماية الحسابات وتتبع التعديلات.</li>
        </ul>
      </Section>

      <Section title="لماذا نستخدمها">
        <ul className="list-disc space-y-1 pe-6">
          <li>استلام الطلبات وتجهيزها وتوصيلها وإصدار فواتيرها.</li>
          <li>إثبات التسليم (الوقت والموقع والمستلم) عند أي خلاف.</li>
          <li>إرسال تأكيد الطلب والتذكير وكشف الحساب على واتساب والتطبيق.</li>
          <li>حماية الحسابات وسجل تدقيق لكل تعديل (من، ومتى، وما الذي تغيّر).</li>
        </ul>
        <p>لا نستخدم البيانات للإعلانات، ولا نبيعها لأي جهة.</p>
      </Section>

      <Section title="مع من نشاركها">
        <p>فقط مع مزوّدي الخدمة اللازمين لتشغيل النظام، وبالقدر اللازم:</p>
        <ul className="list-disc space-y-1 pe-6">
          <li>Meta (واتساب للأعمال) لإرسال رسائل الطلبات وكشوف الحساب إلى رقم العميل.</li>
          <li>Expo لإرسال إشعارات التطبيق.</li>
          <li>مزوّد البريد الإلكتروني لإرسال رمز الدخول.</li>
          <li>مزوّد الاستضافة والنسخ الاحتياطي حيث تُحفظ البيانات مشفّرة أثناء النقل (SSL).</li>
        </ul>
      </Section>

      <Section title="مدة الاحتفاظ">
        <p>
          تُحفظ الفواتير والمدفوعات والطلبات طوال مدة التعامل وبما تتطلبه حسابات المخبز. يُحذف رمز
          الدخول بعد استخدامه أو انتهاء صلاحيته خلال دقائق.
        </p>
      </Section>

      <Section title="حقوقك">
        <p>
          يمكنك طلب نسخة من بياناتك أو تصحيحها أو حذف حسابك بالتواصل مع المخبز. الفواتير والمدفوعات
          قد نحتفظ بها لأسباب محاسبية حتى بعد إغلاق الحساب.
        </p>
      </Section>

      <Section title="التواصل">
        <p>
          {OWNER}
          {EMAIL && (
            <>
              {' '}
              — البريد:{' '}
              <span dir="ltr" className="select-all font-mono">
                {EMAIL}
              </span>
            </>
          )}
          {PHONE && (
            <>
              {' '}
              — الهاتف:{' '}
              <span dir="ltr" className="select-all font-mono">
                {PHONE}
              </span>
            </>
          )}
        </p>
      </Section>
    </main>
  );
}
