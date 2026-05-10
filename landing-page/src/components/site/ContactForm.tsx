"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { sendContactMessage } from "@/lib/websiteSettings";

const labels = {
  en: {
    title: "Send us a message",
    name: "Name",
    email: "Email",
    phone: "Phone",
    optional: "optional",
    message: "Message",
    submit: "Submit message",
    submitting: "Sending...",
    success: "Thank you for contacting us. Your message has been sent successfully.",
    error: "Something went wrong. Please try again.",
  },
  ar: {
    title: "أرسل لنا رسالة",
    name: "الاسم",
    email: "البريد الإلكتروني",
    phone: "رقم الجوال",
    optional: "اختياري",
    message: "الرسالة",
    submit: "إرسال الرسالة",
    submitting: "جارٍ الإرسال...",
    success: "شكرًا لتواصلك، تم إرسال رسالتك بنجاح.",
    error: "حدث خطأ أثناء الإرسال، يرجى المحاولة مرة أخرى.",
  },
};

export default function ContactForm({ language = "en" }: { language?: "en" | "ar" }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [loading, setLoading] = useState(false);
  const t = labels[language];
  const textAlign = language === "ar" ? "text-right" : "text-left";
  const rowDirection = language === "ar" ? "sm:flex-row-reverse" : "sm:flex-row";

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setStatus("idle");
  };

  return (
    <div className="rounded-[2rem] border border-blue-200 bg-white p-6 shadow-2xl shadow-blue-950/15 sm:p-8">
      <h3 className={`text-2xl font-bold tracking-normal text-[#061a4f] ${textAlign}`}>{t.title}</h3>
      <form
        className="mt-6 grid gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setLoading(true);
          setStatus("idle");

          const ok = await sendContactMessage(form);
          if (ok) {
            setForm({ name: "", email: "", phone: "", message: "" });
            setStatus("success");
          } else {
            setStatus("error");
          }

          setLoading(false);
        }}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className={`block ${textAlign}`}>
            <span className="text-sm font-semibold text-slate-700">{t.name}</span>
            <input
              name="name"
              required
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </label>
          <label className={`block ${textAlign}`}>
            <span className="text-sm font-semibold text-slate-700">{t.email}</span>
            <input
              name="email"
              type="email"
              required
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
          </label>
        </div>

        <label className={`block ${textAlign}`}>
          <span className="text-sm font-semibold text-slate-700">
            {t.phone} <span className="font-normal text-slate-400">({t.optional})</span>
          </span>
          <input
            name="phone"
            type="tel"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />
        </label>

        <label className={`block ${textAlign}`}>
          <span className="text-sm font-semibold text-slate-700">{t.message}</span>
          <textarea
            name="message"
            required
            rows={5}
            value={form.message}
            onChange={(event) => updateField("message", event.target.value)}
            className="mt-2 w-full resize-none rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />
        </label>

        <div className={`flex flex-col gap-4 ${rowDirection}`}>
          <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1D4ED8] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:bg-[#071A3D] hover:shadow-xl hover:shadow-blue-500/30 disabled:cursor-not-allowed disabled:opacity-70">
            <Mail size={18} />
            {loading ? t.submitting : t.submit}
          </button>
          {status !== "idle" && (
            <p className={`rounded-full px-4 py-3 text-center text-sm font-semibold ${status === "success" ? "bg-cyan-50 text-[#061a4f]" : "bg-red-50 text-red-700"}`}>
              {status === "success" ? t.success : t.error}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
