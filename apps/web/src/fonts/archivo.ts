import { Archivo } from "next/font/google";

// Only for the Logo; import it from routes that render the wordmark so pro pages never load it.
export const archivo = Archivo({
  axes: ["wdth"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
});
