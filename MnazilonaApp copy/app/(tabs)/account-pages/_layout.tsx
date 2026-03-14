import { Stack } from "expo-router"; // UPDATED (نفسه غالبًا)

export default function AccountPagesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // UPDATED: نخفي هيدر الستاك لأننا نسوي الهيدر داخل الصفحات
      }}
    />
  );
}