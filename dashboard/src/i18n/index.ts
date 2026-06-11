import { en } from './en'
import { ar } from './ar'

export type Lang = 'en' | 'ar'
export type Translations = typeof en

export const translations: Record<Lang, Translations> = { en, ar }
