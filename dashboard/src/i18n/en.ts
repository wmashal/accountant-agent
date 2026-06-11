export const en = {
  // Login
  loginTitle: 'Accountant Dashboard',
  loginSubtitle: 'Sign in to your account',
  loginUsername: 'Username',
  loginPassword: 'Password',
  loginButton: 'Sign In',
  loginError: 'Invalid credentials',

  // Sidebar
  invoiceDashboard: 'Invoice Dashboard',
  allCustomers: 'All customers',
  searchPlaceholder: 'Search customers…',
  loading: 'Loading…',
  noCustomers: 'No customers',
  logout: 'Logout',
  addCustomer: '+ Add Customer',

  // Summary cards
  confirmedIncome: 'Confirmed Income',
  confirmedExpenses: 'Confirmed Expenses',
  net: 'Net',

  // Empty state
  selectCustomer: 'Select a customer',
  selectCustomerSub: 'Choose a customer from the sidebar to view their receipts',

  // Customer header
  editHint: '✎',
  driveFolderLink: 'Drive Folder',
  refreshButton: 'Refresh',

  // Profile edit form
  profileName: 'Name',
  profileCompany: 'Company',
  profileCompanyId: 'Company ID',
  profilePhone: 'Phone',
  saveButton: 'Save',
  cancelButton: 'Cancel',

  // Add Customer modal
  addCustomerTitle: 'Add New Customer',
  addCustomerName: 'Name *',
  addCustomerCompany: 'Company Name',
  addCustomerCompanyId: 'Company ID / Tax ID',
  addCustomerPhone: 'Phone (optional — for WhatsApp)',
  addCustomerPhonePlaceholder: '+1415...',
  createButton: 'Create',
  creatingButton: 'Creating…',
  addCustomerError: 'Error creating customer',
  driveFolderCreated: 'Drive folder created!',
  driveFolderOpenLink: 'Open Google Drive Folder',
  driveFolderHint: 'Share this folder with your customer to let them upload receipts',
  doneButton: 'Done',

  // Filter tabs
  filterAll: 'All',
  filterIncome: 'Income',
  filterExpense: 'Expense',

  // Filter dropdowns
  filterYear: 'Year',
  filterAllYears: 'All Years',
  filterMonth: 'Month',
  filterAllMonths: 'All Months',
  filterStatus: 'Status',
  filterAllStatuses: 'All Statuses',
  groupBy: 'Group By',
  groupByUpload: 'Upload Month',
  groupByInvoice: 'Invoice Month',

  // Table headers
  colDate: 'Date',
  colUploadDate: 'Upload Date',
  colReceiptNo: 'Receipt #',
  colSupplier: 'Supplier / Payer',
  colAmount: 'Amount',
  colTax: 'Tax',
  colType: 'Type',
  colStatus: 'Status',
  colFile: '',
  colSource: 'Src',
  colActions: '',

  // Month group dim badges
  dimUpload: 'upload',
  dimInvoiceDate: 'invoice date',

  // Type labels
  typeIncome: 'Income',
  typeExpense: 'Expense',

  // Status labels
  statusProcessing: 'Processing',
  statusPendingConfirmation: 'Pending',
  statusConfirmed: 'Confirmed',
  statusRejected: 'Rejected',
  statusError: 'Error',

  // Actions
  editTooltip: 'Edit',
  deleteTooltip: 'Delete',
  moveTooltip: 'Move to',
  viewFileTooltip: 'View file',

  // Edit row placeholders
  editVendorPlaceholder: 'Vendor',
  editAmountPlaceholder: 'Amount',
  editTaxPlaceholder: 'Tax',
  editDatePlaceholder: 'YYYY-MM-DD',
  editReceiptNoPlaceholder: 'Receipt #',

  // Month group
  noReceiptsInPeriod: 'No receipts in this period',

  // Month totals row
  monthTotal: 'Total',

  // Months
  months: ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'],

  // Export
  exportCsv: 'Export CSV',

  // Dynamic helpers
  invoicesCount: (n: number) => `${n} invoice${n !== 1 ? 's' : ''}`,
  deleteConfirm: (vendor: string) => `Delete receipt from ${vendor}?`,
  moveConfirm: (vendor: string, to: string) => `Move "${vendor}" to ${to}?`,
}

export type Translations = typeof en
