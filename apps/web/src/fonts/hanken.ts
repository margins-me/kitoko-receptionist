import { Hanken_Grotesk } from "next/font/google";

export const hanken = Hanken_Grotesk({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-hanken",
});
