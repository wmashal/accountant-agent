import { createContext, useContext } from 'react'
import { Lang, Translations, translations } from './index'

export interface LangContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: Translations
}

export const LangContext = createContext<LangContextValue>({
  lang: 'en',
  setLang: () => {},
  t: translations.en,
})

export function useLang(): LangContextValue {
  return useContext(LangContext)
}
