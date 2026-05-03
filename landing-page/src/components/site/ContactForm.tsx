"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

const labels = {
  en: {
    title: "Send us a message",
    name: "Name",
    email: "Email",
    phone: "Phone",
    optional: "optional",
    message: "Message",
    submit: "Submit message",
    success: "Thanks. Your message has been received.",
  },
  ar: {
    title: "أرسل لنا رسالة",
    name: "الاسم",
    email: "البريد الإلكتروني",
    phone: "رقم الجوال",
    optional: "اختياري",
    message: "الرسالة",
    submit: "إرسال الرسالة",
    success: "شكراً لك. تم استلام رسالتك بنجاح.",
  },
};

export default function ContactForm({ language = "en" }: { language?: "en" | "ar" }) {
  const [submitted, setSubmitted] = useState(false);
  const t = labels[language];
  const textAlign = language === "ar" ? "text-right" : "text-left";
  const rowDirection = language === "ar" ? "sm:flex-row-reverse" : "sm:flex-row";

  return (
    <div className="rounded-[2rem] border border-blue-200 bg-white p-6 shadow-2xl shadow-blue-950/15 sm:p-8">
      <h3 className={`text-2xl font-bold tracking-normal text-[#061a4f] ${textAlign}`}>{t.title}</h3>
      <form
        className="mt-6 grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          event.currentTarget.reset();
          setSubmitted(true);
        }}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className={`block ${textAlign}`}>
            <span className="text-sm font-semibold text-slate-700">{t.name}</span>
            <input name="name" required className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100" />
          </label>
          <label className={`block ${textAlign}`}>
            <span className="text-sm font-semibold text-slate-700">{t.email}</span>
            <input name="email" type="email" required className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100" />
          </label>
        </div>

        <label className={`block ${textAlign}`}>
          <span className="text-sm font-semibold text-slate-700">
            {t.phone} <span className="font-normal text-slate-400">({t.optional})</span>
          </span>
          <input name="phone" type="tel" className="mt-2 w-full rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100" />
        </label>

        <label className={`block ${textAlign}`}>
          <span className="text-sm font-semibold text-slate-700">{t.message}</span>
          <textarea name="message" required rows={5} className="mt-2 w-full resize-none rounded-2xl border border-blue-100 bg-[#f8fbff] px-4 py-3 text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100" />
        </label>

        <div className={`flex flex-col gap-4 ${rowDirection}`}>
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1D4ED8] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:bg-[#071A3D] hover:shadow-xl hover:shadow-blue-500/30">
            <Mail size={18} />
            {t.submit}
          </button>
          {submitted && (
            <p className="rounded-full bg-cyan-50 px-4 py-3 text-center text-sm font-semibold text-[#061a4f]">
              {t.success}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
