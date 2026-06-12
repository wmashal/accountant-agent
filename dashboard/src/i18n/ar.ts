import { Translations } from './en'

export const ar: Translations = {
  // Login
  loginTitle: 'لوحة المحاسب',
  loginSubtitle: 'تسجيل الدخول إلى حسابك',
  loginUsername: 'اسم المستخدم',
  loginPassword: 'كلمة المرور',
  loginButton: 'دخول',
  loginError: 'بيانات الدخول غير صحيحة',

  // Sidebar
  invoiceDashboard: 'لوحة الفواتير',
  allCustomers: 'جميع العملاء',
  searchPlaceholder: 'البحث في العملاء…',
  loading: 'جارٍ التحميل…',
  noCustomers: 'لا يوجد عملاء',
  logout: 'تسجيل الخروج',
  addCustomer: '+ إضافة عميل',
  navDashboard: 'الرئيسية',
  navCustomers: 'العملاء',

  // Summary cards
  confirmedIncome: 'الدخل المؤكد',
  confirmedExpenses: 'المصروفات المؤكدة',
  net: 'الصافي',

  // Empty state
  selectCustomer: 'اختر عميلاً',
  selectCustomerSub: 'اختر عميلاً من الشريط الجانبي لعرض فواتيره',

  // Customer header
  editHint: '✎',
  driveFolderLink: 'مجلد Drive',
  refreshButton: 'تحديث',

  // Profile edit form
  profileName: 'الاسم',
  profileCompany: 'الشركة',
  profileCompanyId: 'رقم الشركة',
  profilePhone: 'الهاتف',
  saveButton: 'حفظ',
  cancelButton: 'إلغاء',

  // Add Customer modal
  addCustomerTitle: 'إضافة عميل جديد',
  addCustomerName: 'الاسم *',
  addCustomerCompany: 'اسم الشركة',
  addCustomerCompanyId: 'الرقم الضريبي',
  addCustomerPhone: 'الهاتف (اختياري — للواتساب)',
  addCustomerPhonePlaceholder: '+1415...',
  createButton: 'إنشاء',
  creatingButton: 'جارٍ الإنشاء…',
  addCustomerError: 'خطأ في إنشاء العميل',
  driveFolderCreated: 'تم إنشاء مجلد Drive!',
  driveFolderOpenLink: 'فتح مجلد Google Drive',
  driveFolderHint: 'شارك هذا المجلد مع عميلك لرفع الفواتير',
  doneButton: 'تم',

  // Filter tabs
  filterAll: 'الكل',
  filterIncome: 'دخل',
  filterExpense: 'مصروف',

  // Filter dropdowns
  filterYear: 'السنة',
  filterAllYears: 'كل السنوات',
  filterMonth: 'الشهر',
  filterAllMonths: 'كل الشهور',
  filterStatus: 'الحالة',
  filterAllStatuses: 'كل الحالات',
  groupBy: 'تجميع حسب',
  groupByUpload: 'شهر الرفع',
  groupByInvoice: 'شهر الفاتورة',

  // Table headers
  colDate: 'التاريخ',
  colUploadDate: 'تاريخ الرفع',
  colReceiptNo: 'رقم الفاتورة',
  colSupplier: 'المورد / الدافع',
  colAmount: 'المبلغ',
  colTax: 'الضريبة',
  colType: 'النوع',
  colStatus: 'الحالة',
  colFile: '',
  colSource: 'مصدر',
  colActions: '',

  // Month group dim badges
  dimUpload: 'رفع',
  dimInvoiceDate: 'تاريخ الفاتورة',

  // Type labels
  typeIncome: 'دخل',
  typeExpense: 'مصروف',

  // Status labels
  statusProcessing: 'قيد المعالجة',
  statusPendingConfirmation: 'بانتظار التأكيد',
  statusConfirmed: 'مؤكد',
  statusRejected: 'مرفوض',
  statusError: 'خطأ',

  // Actions
  editTooltip: 'تعديل',
  deleteTooltip: 'حذف',
  moveTooltip: 'نقل إلى',
  viewFileTooltip: 'عرض الملف',

  // Edit row placeholders
  editVendorPlaceholder: 'المورد',
  editAmountPlaceholder: 'المبلغ',
  editTaxPlaceholder: 'الضريبة',
  editDatePlaceholder: 'YYYY-MM-DD',
  editReceiptNoPlaceholder: 'رقم الفاتورة',

  // Month group
  noReceiptsInPeriod: 'لا توجد فواتير في هذه الفترة',

  // Month totals row
  monthTotal: 'المجموع',

  // Months
  months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],

  // Export
  exportCsv: 'تصدير CSV',
  filterDateInvoice: 'التاريخ (فاتورة)',

  // Home dashboard
  needsAttentionTitle: 'يحتاج مراجعة',
  needsAttentionEmpty: 'لا توجد فواتير معلّقة',
  pendingInvoices: (n: number) => `${n} معلّق`,
  monthlyOverviewTitle: 'النظرة الشهرية',
  pendingByCustomerTitle: 'المعلّق حسب العميل',
  chartIncome: 'دخل',
  chartExpense: 'مصروف',
  chartPending: 'معلّق',

  // Dynamic helpers
  invoicesCount: (n: number) => `${n} ${n === 1 ? 'فاتورة' : 'فواتير'}`,
  deleteConfirm: (vendor: string) => `حذف فاتورة ${vendor}؟`,
  moveConfirm: (vendor: string, to: string) => `نقل "${vendor}" إلى ${to}؟`,
}
