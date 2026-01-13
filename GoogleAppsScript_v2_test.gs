// ============ CEAM RAFFLE TRACKER - ENHANCED VERSION ============
// Incorporates login system features: validity periods, approval workflow, 
// day-based access, OTP password reset, and auto-expiration

// ============ CONFIGURATION ============

const TICKETS_SHEET_NAME = 'Tickets';
const STAFF_SHEET_NAME = 'Staff';
const CONFIG_SHEET_NAME = 'Config'; // NEW: For day-based URLs and settings

// Rate limiting
const RATE_LIMITS = {
  read: { requests: 100, window: 60 },
  write: { requests: 30, window: 60 },
  search: { requests: 20, window: 60 },
  auth: { requests: 10, window: 60 } // Stricter for auth attempts
};

const CACHE_TTL = 300;
const ENABLE_LOGGING = true;
const OTP_EXPIRY_MINUTES = 10;
const DEFAULT_VALIDITY_DAYS = 30;

// ============ MAIN HANDLERS ============

function doGet(e) {
  // Handle direct execution from editor (no event object)
  if (!e || !e.parameter) {
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'CEAM Raffle API is running. Access via web URL with ?action=ping to test.',
      availableActions: ['ping', 'login', 'register', 'read', 'search', 'stats'],
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  // Check if this is a page request or API request
  const page = e.parameter.page;
  
  if (page === 'login') {
    return HtmlService.createHtmlOutputFromFile('LoginPage')
      .setTitle('CEAM Raffle - Login')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  if (page === 'register') {
    return HtmlService.createHtmlOutputFromFile('RegisterPage')
      .setTitle('CEAM Raffle - Register')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  if (page === 'forgot') {
    return HtmlService.createHtmlOutputFromFile('ForgotPasswordPage')
      .setTitle('CEAM Raffle - Reset Password')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // Default: API request
  return handleRequest(e, 'GET');
}

function doPost(e) {
  return handleRequest(e, 'POST');
}

function handleRequest(e, method) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const action = e.parameter.action || 'read';
    
    // Public actions (no auth required)
    const publicActions = ['login', 'register', 'forgot_password', 'verify_otp', 'reset_password', 'ping'];
    
    if (publicActions.includes(action)) {
      const handlers = {
        'login': handleLogin,
        'register': handleRegister,
        'forgot_password': handleForgotPassword,
        'verify_otp': handleVerifyOTP,
        'reset_password': handleResetPassword,
        'ping': () => createSuccessResponse({ message: 'Connected' })
      };
      
      const result = handlers[action](e);
      return output.setContent(JSON.stringify(result));
    }
    
    // Protected actions - require authentication
    let currentUser;
    try {
      currentUser = getCurrentUser();
      
      if (currentUser.source === 'effective') {
        const activeEmail = Session.getActiveUser().getEmail();
        if (!activeEmail || activeEmail === currentUser.email) {
          return output.setContent(JSON.stringify(createErrorResponse('AUTH_REQUIRED')));
        }
        currentUser.email = activeEmail;
      }
    } catch (error) {
      return output.setContent(JSON.stringify(createErrorResponse('AUTH_REQUIRED')));
    }
    
    const actionType = getActionType(action);
    const rateCheck = checkAdvancedRateLimit(currentUser.email, actionType);
    if (!rateCheck.allowed) {
      return output.setContent(JSON.stringify(createErrorResponse('RATE_LIMIT', {
        retryAfter: rateCheck.retryAfter
      })));
    }
    
    const handlers = {
      'read': handleRead,
      'read_chunk': handleReadChunk,
      'update': handleUpdateOptimized,
      'batch_update': handleBatchUpdateOptimized,
      'add': handleAdd,
      'delete': handleDelete,
      'search': handleSearch,
      'fuzzy_search': handleFuzzySearch,
      'stats': handleStats,
      'validate_staff': handleValidateStaff,
      'get_staff_list': handleGetStaffList,
      'get_current_user': handleGetCurrentUser,
      'update_staff': handleUpdateStaff,        // NEW: Admin can update staff
      'approve_staff': handleApproveStaff,      // NEW: Approve pending accounts
      'extend_validity': handleExtendValidity,   // NEW: Extend account validity
      'get_day_url': handleGetDayUrl            // NEW: Get URL for current day
    };
    
    const handler = handlers[action];
    if (!handler) {
      return output.setContent(JSON.stringify(createErrorResponse('INVALID_ACTION')));
    }
    
    const result = handler(e, currentUser);
    return output.setContent(JSON.stringify(result));
    
  } catch (error) {
    logAction('ERROR', { error: error.toString(), stack: error.stack });
    return output.setContent(JSON.stringify(createErrorResponse('SERVER_ERROR', {
      detail: error.message
    })));
  }
}

// ============ STANDARDIZED RESPONSES ============

const ERROR_CODES = {
  AUTH_REQUIRED: { status: 401, message: 'Authentication required' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid username or password' },
  ACCOUNT_PENDING: { status: 403, message: 'Account pending admin approval' },
  ACCOUNT_EXPIRED: { status: 403, message: 'Account validity has expired' },
  ACCOUNT_DISABLED: { status: 403, message: 'Account has been disabled' },
  UNAUTHORIZED: { status: 403, message: 'You are not authorized' },
  INSUFFICIENT_ROLE: { status: 403, message: 'Insufficient permissions' },
  EMAIL_EXISTS: { status: 409, message: 'Email already registered' },
  INVALID_OTP: { status: 400, message: 'Invalid or expired OTP' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  RATE_LIMIT: { status: 429, message: 'Too many requests' },
  INVALID_INPUT: { status: 400, message: 'Invalid input data' },
  INVALID_JSON: { status: 400, message: 'Invalid JSON format' },
  INVALID_ACTION: { status: 400, message: 'Invalid action' },
  VERSION_CONFLICT: { status: 409, message: 'Data modified by another user' },
  SERVER_ERROR: { status: 500, message: 'Internal server error' }
};

function createErrorResponse(code, details = {}) {
  const error = ERROR_CODES[code] || ERROR_CODES.SERVER_ERROR;
  return {
    success: false,
    error: error.message,
    code: code,
    status: error.status,
    details: details,
    timestamp: new Date().toISOString()
  };
}

function createSuccessResponse(data, meta = {}) {
  return {
    success: true,
    ...data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

// ============ NEW: LOGIN/REGISTRATION SYSTEM ============

/**
 * Handle user login with validity checking
 * Features from video: day-based URL redirect, validity expiration, approval check
 */
function handleLogin(e) {
  try {
    const email = sanitizeInput(e.parameter.email || e.parameter.username || '').toLowerCase();
    const password = e.parameter.password || '';
    
    if (!email || !password) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Email and password required' });
    }
    
    // Rate limit auth attempts
    const rateCheck = checkAdvancedRateLimit(email, 'auth');
    if (!rateCheck.allowed) {
      return createErrorResponse('RATE_LIMIT', { retryAfter: rateCheck.retryAfter });
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    if (!sheet) return createErrorResponse('SERVER_ERROR', { detail: 'Staff sheet not found' });
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Find column indices
    const emailIdx = headers.indexOf('Email');
    const nameIdx = headers.indexOf('Name');
    const roleIdx = headers.indexOf('Role');
    const activeIdx = headers.indexOf('Active');
    const passwordIdx = headers.indexOf('Password');
    const statusIdx = headers.indexOf('Status'); // Approved, Pending, Disabled
    const createdIdx = headers.indexOf('Created_Date');
    const validityIdx = headers.indexOf('Validity_Days');
    
    // Day-based URL columns
    const dayColumns = {
      0: headers.indexOf('Sunday_URL'),
      1: headers.indexOf('Monday_URL'),
      2: headers.indexOf('Tuesday_URL'),
      3: headers.indexOf('Wednesday_URL'),
      4: headers.indexOf('Thursday_URL'),
      5: headers.indexOf('Friday_URL'),
      6: headers.indexOf('Saturday_URL')
    };
    
    for (let i = 1; i < data.length; i++) {
      const rowEmail = (data[i][emailIdx] || '').toString().toLowerCase();
      
      if (rowEmail === email) {
        // Check password
        const storedPassword = data[i][passwordIdx] || '';
        if (storedPassword !== password && !verifyPassword(password, storedPassword)) {
          logAction('LOGIN_FAILED', { email: email, reason: 'Invalid password' });
          return createErrorResponse('INVALID_CREDENTIALS');
        }
        
        // Check approval status
        const status = (data[i][statusIdx] || 'Approved').toString();
        if (status === 'Pending') {
          logAction('LOGIN_FAILED', { email: email, reason: 'Pending approval' });
          return createErrorResponse('ACCOUNT_PENDING');
        }
        if (status === 'Disabled' || status === 'Disapproved') {
          logAction('LOGIN_FAILED', { email: email, reason: 'Account disabled' });
          return createErrorResponse('ACCOUNT_DISABLED');
        }
        
        // Check validity period
        const createdDate = data[i][createdIdx];
        const validityDays = parseInt(data[i][validityIdx]) || DEFAULT_VALIDITY_DAYS;
        
        if (createdDate) {
          const created = new Date(createdDate);
          const expiryDate = new Date(created.getTime() + (validityDays * 24 * 60 * 60 * 1000));
          const now = new Date();
          
          if (now > expiryDate) {
            // Auto-disable expired account
            if (statusIdx >= 0) {
              sheet.getRange(i + 1, statusIdx + 1).setValue('Expired');
            }
            logAction('LOGIN_FAILED', { email: email, reason: 'Account expired' });
            return createErrorResponse('ACCOUNT_EXPIRED', {
              expiredOn: expiryDate.toISOString(),
              validityDays: validityDays
            });
          }
        }
        
        // Check active flag
        const active = data[i][activeIdx];
        if (active === false || active === 'false' || active === 'FALSE') {
          return createErrorResponse('ACCOUNT_DISABLED');
        }
        
        // Get day-based redirect URL
        const today = new Date().getDay(); // 0 = Sunday, 6 = Saturday
        const dayUrlIdx = dayColumns[today];
        const redirectUrl = dayUrlIdx >= 0 ? data[i][dayUrlIdx] : null;
        
        // Calculate days remaining
        let daysRemaining = null;
        if (createdDate && validityDays) {
          const created = new Date(createdDate);
          const expiryDate = new Date(created.getTime() + (validityDays * 24 * 60 * 60 * 1000));
          daysRemaining = Math.ceil((expiryDate - new Date()) / (24 * 60 * 60 * 1000));
        }
        
        // Generate session token
        const sessionToken = generateSessionToken(email);
        
        logAction('LOGIN_SUCCESS', { 
          email: email, 
          name: data[i][nameIdx],
          daysRemaining: daysRemaining 
        });
        
        return createSuccessResponse({
          message: 'Login successful',
          user: {
            email: rowEmail,
            name: data[i][nameIdx] || email.split('@')[0],
            role: data[i][roleIdx] || 'staff'
          },
          sessionToken: sessionToken,
          redirectUrl: redirectUrl,
          validity: {
            daysRemaining: daysRemaining,
            expiresOn: createdDate ? new Date(new Date(createdDate).getTime() + (validityDays * 24 * 60 * 60 * 1000)).toISOString() : null
          }
        });
      }
    }
    
    logAction('LOGIN_FAILED', { email: email, reason: 'User not found' });
    return createErrorResponse('INVALID_CREDENTIALS');
    
  } catch (error) {
    logAction('LOGIN_ERROR', { error: error.message });
    return createErrorResponse('SERVER_ERROR', { detail: error.message });
  }
}

/**
 * Handle new user registration
 * Features from video: Creates account in Pending status for admin approval
 */
function handleRegister(e) {
  try {
    const email = sanitizeInput(e.parameter.email || '').toLowerCase();
    const name = sanitizeInput(e.parameter.name || '');
    const password = e.parameter.password || '';
    const confirmPassword = e.parameter.confirm_password || '';
    
    // Validation
    if (!email || !password) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Email and password required' });
    }
    
    if (!isValidEmail(email)) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Invalid email format' });
    }
    
    if (password.length < 6) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Password must be at least 6 characters' });
    }
    
    if (confirmPassword && password !== confirmPassword) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Passwords do not match' });
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    if (!sheet) return createErrorResponse('SERVER_ERROR');
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Check if email exists
    const emailIdx = headers.indexOf('Email');
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === email) {
        return createErrorResponse('EMAIL_EXISTS');
      }
    }
    
    // Find column indices for new row
    const cols = {
      email: emailIdx,
      name: headers.indexOf('Name'),
      role: headers.indexOf('Role'),
      active: headers.indexOf('Active'),
      password: headers.indexOf('Password'),
      status: headers.indexOf('Status'),
      created: headers.indexOf('Created_Date'),
      validity: headers.indexOf('Validity_Days'),
      otp: headers.indexOf('OTP')
    };
    
    // Build new row
    const newRow = new Array(headers.length).fill('');
    newRow[cols.email] = email;
    if (cols.name >= 0) newRow[cols.name] = name || email.split('@')[0];
    if (cols.role >= 0) newRow[cols.role] = 'staff';
    if (cols.active >= 0) newRow[cols.active] = false; // Inactive until approved
    if (cols.password >= 0) newRow[cols.password] = hashPassword(password);
    if (cols.status >= 0) newRow[cols.status] = 'Pending';
    if (cols.created >= 0) newRow[cols.created] = new Date().toISOString();
    if (cols.validity >= 0) newRow[cols.validity] = DEFAULT_VALIDITY_DAYS;
    
    sheet.appendRow(newRow);
    
    logAction('REGISTER', { email: email, name: name });
    
    // Notify admin (optional)
    notifyAdminNewRegistration(email, name);
    
    return createSuccessResponse({
      message: 'Account created! Please wait for admin approval.',
      email: email,
      status: 'Pending'
    });
    
  } catch (error) {
    logAction('REGISTER_ERROR', { error: error.message });
    return createErrorResponse('SERVER_ERROR', { detail: error.message });
  }
}

/**
 * Handle forgot password - sends OTP to email
 */
function handleForgotPassword(e) {
  try {
    const email = sanitizeInput(e.parameter.email || '').toLowerCase();
    
    if (!email) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Email required' });
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    if (!sheet) return createErrorResponse('SERVER_ERROR');
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const emailIdx = headers.indexOf('Email');
    const otpIdx = headers.indexOf('OTP');
    const otpExpiryIdx = headers.indexOf('OTP_Expiry');
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === email) {
        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
        
        // Save OTP to sheet
        if (otpIdx >= 0) {
          sheet.getRange(i + 1, otpIdx + 1).setValue(otp);
        }
        if (otpExpiryIdx >= 0) {
          sheet.getRange(i + 1, otpExpiryIdx + 1).setValue(expiry.toISOString());
        }
        
        // Send OTP email
        try {
          MailApp.sendEmail({
            to: email,
            subject: 'CEAM Raffle - Password Reset OTP',
            htmlBody: `
              <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                <h2 style="color: #1A4B8C;">Password Reset Request</h2>
                <p>Your OTP code is:</p>
                <div style="background: #f0f9ff; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1A4B8C; border-radius: 10px;">
                  ${otp}
                </div>
                <p style="color: #666; margin-top: 20px;">
                  This code expires in ${OTP_EXPIRY_MINUTES} minutes.<br>
                  If you didn't request this, please ignore this email.
                </p>
                <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">CEAM Raffle Ticket System</p>
              </div>
            `
          });
        } catch (mailError) {
          logAction('OTP_EMAIL_FAILED', { email: email, error: mailError.message });
          // Still return success - OTP is saved, admin can see it
        }
        
        logAction('OTP_SENT', { email: email });
        
        return createSuccessResponse({
          message: 'OTP sent to your email',
          email: maskEmail(email),
          expiresIn: OTP_EXPIRY_MINUTES + ' minutes'
        });
      }
    }
    
    // Don't reveal if email exists or not (security)
    return createSuccessResponse({
      message: 'If this email is registered, you will receive an OTP',
      email: maskEmail(email)
    });
    
  } catch (error) {
    return createErrorResponse('SERVER_ERROR', { detail: error.message });
  }
}

/**
 * Verify OTP code
 */
function handleVerifyOTP(e) {
  try {
    const email = sanitizeInput(e.parameter.email || '').toLowerCase();
    const otp = e.parameter.otp || '';
    
    if (!email || !otp) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Email and OTP required' });
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const emailIdx = headers.indexOf('Email');
    const otpIdx = headers.indexOf('OTP');
    const otpExpiryIdx = headers.indexOf('OTP_Expiry');
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === email) {
        const storedOtp = (data[i][otpIdx] || '').toString();
        const expiry = data[i][otpExpiryIdx];
        
        if (!storedOtp || storedOtp !== otp) {
          return createErrorResponse('INVALID_OTP');
        }
        
        if (expiry && new Date(expiry) < new Date()) {
          return createErrorResponse('INVALID_OTP', { detail: 'OTP has expired' });
        }
        
        // Generate reset token
        const resetToken = Utilities.getUuid();
        
        // Store reset token (reuse OTP column temporarily)
        sheet.getRange(i + 1, otpIdx + 1).setValue('RESET:' + resetToken);
        
        return createSuccessResponse({
          message: 'OTP verified',
          resetToken: resetToken
        });
      }
    }
    
    return createErrorResponse('INVALID_OTP');
    
  } catch (error) {
    return createErrorResponse('SERVER_ERROR', { detail: error.message });
  }
}

/**
 * Reset password with verified token
 */
function handleResetPassword(e) {
  try {
    const email = sanitizeInput(e.parameter.email || '').toLowerCase();
    const resetToken = e.parameter.reset_token || '';
    const newPassword = e.parameter.new_password || '';
    
    if (!email || !resetToken || !newPassword) {
      return createErrorResponse('INVALID_INPUT', { detail: 'All fields required' });
    }
    
    if (newPassword.length < 6) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Password must be at least 6 characters' });
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const emailIdx = headers.indexOf('Email');
    const otpIdx = headers.indexOf('OTP');
    const passwordIdx = headers.indexOf('Password');
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === email) {
        const storedToken = (data[i][otpIdx] || '').toString();
        
        if (storedToken !== 'RESET:' + resetToken) {
          return createErrorResponse('INVALID_OTP', { detail: 'Invalid reset token' });
        }
        
        // Update password and clear OTP
        if (passwordIdx >= 0) {
          sheet.getRange(i + 1, passwordIdx + 1).setValue(hashPassword(newPassword));
        }
        sheet.getRange(i + 1, otpIdx + 1).setValue(''); // Clear token
        
        logAction('PASSWORD_RESET', { email: email });
        
        return createSuccessResponse({
          message: 'Password reset successfully! You can now login.'
        });
      }
    }
    
    return createErrorResponse('INVALID_OTP');
    
  } catch (error) {
    return createErrorResponse('SERVER_ERROR', { detail: error.message });
  }
}

// ============ NEW: ADMIN FUNCTIONS ============

/**
 * Approve pending staff account (admin only)
 */
function handleApproveStaff(e, currentUser) {
  try {
    const admin = requireAuthorizedUser('admin');
    const targetEmail = sanitizeInput(e.parameter.target_email || '').toLowerCase();
    const action = e.parameter.approve_action || 'approve'; // approve, reject, disable
    
    if (!targetEmail) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Target email required' });
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const emailIdx = headers.indexOf('Email');
    const activeIdx = headers.indexOf('Active');
    const statusIdx = headers.indexOf('Status');
    const createdIdx = headers.indexOf('Created_Date');
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === targetEmail) {
        const newStatus = action === 'approve' ? 'Approved' : 
                         action === 'reject' ? 'Rejected' : 'Disabled';
        const newActive = action === 'approve';
        
        // Update status
        if (statusIdx >= 0) sheet.getRange(i + 1, statusIdx + 1).setValue(newStatus);
        if (activeIdx >= 0) sheet.getRange(i + 1, activeIdx + 1).setValue(newActive);
        
        // Reset creation date on approval (start validity period now)
        if (action === 'approve' && createdIdx >= 0) {
          sheet.getRange(i + 1, createdIdx + 1).setValue(new Date().toISOString());
        }
        
        logAction('STAFF_' + action.toUpperCase(), { 
          targetEmail: targetEmail, 
          approvedBy: admin.email 
        });
        
        return createSuccessResponse({
          message: `Account ${newStatus.toLowerCase()}`,
          email: targetEmail,
          status: newStatus,
          active: newActive
        });
      }
    }
    
    return createErrorResponse('NOT_FOUND', { detail: 'User not found' });
    
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

/**
 * Extend account validity (admin only)
 */
function handleExtendValidity(e, currentUser) {
  try {
    const admin = requireAuthorizedUser('admin');
    const targetEmail = sanitizeInput(e.parameter.target_email || '').toLowerCase();
    const additionalDays = parseInt(e.parameter.days) || 30;
    
    if (!targetEmail) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Target email required' });
    }
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const emailIdx = headers.indexOf('Email');
    const validityIdx = headers.indexOf('Validity_Days');
    const statusIdx = headers.indexOf('Status');
    const activeIdx = headers.indexOf('Active');
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === targetEmail) {
        const currentValidity = parseInt(data[i][validityIdx]) || DEFAULT_VALIDITY_DAYS;
        const newValidity = currentValidity + additionalDays;
        
        // Update validity
        if (validityIdx >= 0) {
          sheet.getRange(i + 1, validityIdx + 1).setValue(newValidity);
        }
        
        // Re-activate if was expired
        const status = data[i][statusIdx];
        if (status === 'Expired') {
          if (statusIdx >= 0) sheet.getRange(i + 1, statusIdx + 1).setValue('Approved');
          if (activeIdx >= 0) sheet.getRange(i + 1, activeIdx + 1).setValue(true);
        }
        
        logAction('VALIDITY_EXTENDED', { 
          targetEmail: targetEmail, 
          previousDays: currentValidity,
          newDays: newValidity,
          extendedBy: admin.email 
        });
        
        return createSuccessResponse({
          message: `Validity extended to ${newValidity} days`,
          email: targetEmail,
          previousValidity: currentValidity,
          newValidity: newValidity
        });
      }
    }
    
    return createErrorResponse('NOT_FOUND');
    
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

/**
 * Get day-based URL for current user
 */
function handleGetDayUrl(e, currentUser) {
  try {
    const user = requireAuthorizedUser();
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const emailIdx = headers.indexOf('Email');
    const dayColumns = {
      0: headers.indexOf('Sunday_URL'),
      1: headers.indexOf('Monday_URL'),
      2: headers.indexOf('Tuesday_URL'),
      3: headers.indexOf('Wednesday_URL'),
      4: headers.indexOf('Thursday_URL'),
      5: headers.indexOf('Friday_URL'),
      6: headers.indexOf('Saturday_URL')
    };
    
    const today = new Date().getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === user.email.toLowerCase()) {
        const dayUrlIdx = dayColumns[today];
        const url = dayUrlIdx >= 0 ? data[i][dayUrlIdx] : null;
        
        return createSuccessResponse({
          day: dayNames[today],
          dayNumber: today,
          url: url,
          hasUrl: !!url
        });
      }
    }
    
    return createErrorResponse('NOT_FOUND');
    
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

/**
 * Update staff member details (admin only)
 */
function handleUpdateStaff(e, currentUser) {
  try {
    const admin = requireAuthorizedUser('admin');
    const targetEmail = sanitizeInput(e.parameter.target_email || '').toLowerCase();
    
    if (!targetEmail) {
      return createErrorResponse('INVALID_INPUT', { detail: 'Target email required' });
    }
    
    const updates = {};
    if (e.parameter.name) updates.Name = sanitizeInput(e.parameter.name);
    if (e.parameter.role) updates.Role = sanitizeInput(e.parameter.role);
    if (e.parameter.validity_days) updates.Validity_Days = parseInt(e.parameter.validity_days);
    if (e.parameter.monday_url) updates.Monday_URL = e.parameter.monday_url;
    if (e.parameter.tuesday_url) updates.Tuesday_URL = e.parameter.tuesday_url;
    if (e.parameter.wednesday_url) updates.Wednesday_URL = e.parameter.wednesday_url;
    if (e.parameter.thursday_url) updates.Thursday_URL = e.parameter.thursday_url;
    if (e.parameter.friday_url) updates.Friday_URL = e.parameter.friday_url;
    if (e.parameter.saturday_url) updates.Saturday_URL = e.parameter.saturday_url;
    if (e.parameter.sunday_url) updates.Sunday_URL = e.parameter.sunday_url;
    
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const emailIdx = headers.indexOf('Email');
    
    for (let i = 1; i < data.length; i++) {
      if ((data[i][emailIdx] || '').toString().toLowerCase() === targetEmail) {
        // Apply updates
        Object.keys(updates).forEach(key => {
          const colIdx = headers.indexOf(key);
          if (colIdx >= 0) {
            sheet.getRange(i + 1, colIdx + 1).setValue(updates[key]);
          }
        });
        
        logAction('STAFF_UPDATED', { targetEmail, updates, updatedBy: admin.email });
        
        return createSuccessResponse({
          message: 'Staff member updated',
          email: targetEmail,
          updates: updates
        });
      }
    }
    
    return createErrorResponse('NOT_FOUND');
    
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

// ============ HELPER FUNCTIONS ============

function hashPassword(password) {
  // Simple hash for demo - in production use proper bcrypt
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + 'CEAM_SALT');
  return Utilities.base64Encode(hash);
}

function verifyPassword(input, stored) {
  return hashPassword(input) === stored;
}

function generateSessionToken(email) {
  const data = email + Date.now() + Math.random();
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data);
  return Utilities.base64Encode(hash);
}

function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  const masked = local.substring(0, 2) + '***' + local.slice(-1);
  return masked + '@' + domain;
}

function notifyAdminNewRegistration(email, name) {
  try {
    // Get admin emails
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const emailIdx = headers.indexOf('Email');
    const roleIdx = headers.indexOf('Role');
    
    const adminEmails = [];
    for (let i = 1; i < data.length; i++) {
      if ((data[i][roleIdx] || '').toString().toLowerCase() === 'admin') {
        adminEmails.push(data[i][emailIdx]);
      }
    }
    
    if (adminEmails.length > 0) {
      MailApp.sendEmail({
        to: adminEmails.join(','),
        subject: 'CEAM Raffle - New Registration Pending Approval',
        htmlBody: `
          <div style="font-family: Arial, sans-serif;">
            <h2 style="color: #1A4B8C;">New Registration Request</h2>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Name:</strong> ${name || 'Not provided'}</p>
            <p>Please login to approve or reject this account.</p>
          </div>
        `
      });
    }
  } catch (e) {
    // Silent fail - registration shouldn't fail if email fails
  }
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .substring(0, 10000);
}

function sanitizeValues(values) {
  if (!Array.isArray(values)) return values;
  return values.map(v => sanitizeInput(v));
}

// ============ AUTHENTICATION (existing) ============

function getCurrentUser() {
  try {
    const activeEmail = Session.getActiveUser().getEmail();
    if (activeEmail) return { email: activeEmail, source: 'active' };
  } catch (e) {}
  
  try {
    const effectiveEmail = Session.getEffectiveUser().getEmail();
    if (effectiveEmail) return { email: effectiveEmail, source: 'effective' };
  } catch (e) {}
  
  throw new Error('AUTH_REQUIRED');
}

function requireAuthorizedUser(requiredRole = null) {
  const email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('AUTH_REQUIRED');
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
  if (!sheet) throw new Error('STAFF_SHEET_NOT_FOUND');
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const emailIdx = headers.indexOf('Email');
  const nameIdx = headers.indexOf('Name');
  const roleIdx = headers.indexOf('Role');
  const activeIdx = headers.indexOf('Active');
  const statusIdx = headers.indexOf('Status');
  
  for (let i = 1; i < data.length; i++) {
    if ((data[i][emailIdx] || '').toString().toLowerCase() === email.toLowerCase()) {
      // Check status
      const status = (data[i][statusIdx] || 'Approved').toString();
      if (status === 'Pending') throw new Error('ACCOUNT_PENDING');
      if (status === 'Disabled' || status === 'Rejected' || status === 'Expired') {
        throw new Error('ACCOUNT_DISABLED');
      }
      
      // Check active
      const active = data[i][activeIdx];
      if (active === false || active === 'false' || active === 'FALSE') {
        throw new Error('ACCOUNT_DISABLED');
      }
      
      // Check role
      const role = (data[i][roleIdx] || 'staff').toString().toLowerCase();
      if (requiredRole && role !== requiredRole.toLowerCase() && role !== 'admin') {
        throw new Error('INSUFFICIENT_ROLE');
      }
      
      return {
        email: email,
        name: data[i][nameIdx] || email.split('@')[0],
        role: role
      };
    }
  }
  
  throw new Error('UNAUTHORIZED');
}

// ============ RATE LIMITING ============

function getActionType(action) {
  const writeActions = ['update', 'batch_update', 'add', 'delete', 'approve_staff', 'update_staff', 'extend_validity'];
  const searchActions = ['search', 'fuzzy_search'];
  const authActions = ['login', 'register', 'forgot_password', 'verify_otp', 'reset_password'];
  
  if (writeActions.includes(action)) return 'write';
  if (searchActions.includes(action)) return 'search';
  if (authActions.includes(action)) return 'auth';
  return 'read';
}

function checkAdvancedRateLimit(identifier, actionType) {
  const cache = CacheService.getScriptCache();
  const key = `rate_${actionType}_${identifier.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const limit = RATE_LIMITS[actionType] || RATE_LIMITS.read;
  
  const data = JSON.parse(cache.get(key) || '{"count":0,"firstRequest":0}');
  const now = Date.now();
  
  if (now - data.firstRequest > limit.window * 1000) {
    data.count = 1;
    data.firstRequest = now;
    cache.put(key, JSON.stringify(data), limit.window);
    return { allowed: true, remaining: limit.requests - 1 };
  }
  
  if (data.count >= limit.requests) {
    const retryAfter = Math.ceil((data.firstRequest + limit.window * 1000 - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  data.count++;
  cache.put(key, JSON.stringify(data), limit.window);
  return { allowed: true, remaining: limit.requests - data.count };
}

// ============ CACHING ============

function getCachedHeaders() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sheet_headers');
  if (cached) return JSON.parse(cached);
  
  const sheet = getTicketsSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  cache.put('sheet_headers', JSON.stringify(headers), CACHE_TTL);
  return headers;
}

function invalidateHeaderCache() {
  CacheService.getScriptCache().remove('sheet_headers');
}

// ============ TICKET HANDLERS (from original) ============

function handleRead(e, currentUser) {
  try {
    requireAuthorizedUser();
    const sheet = getTicketsSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rows = data.slice(1).map((row, i) => {
      const obj = {};
      headers.forEach((h, j) => obj[h] = row[j]);
      obj._rowNum = i + 2;
      return obj;
    });
    
    logAction('READ', { email: currentUser.email, rowCount: rows.length });
    return createSuccessResponse({ headers, data: rows, totalRows: rows.length });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleReadChunk(e, currentUser) {
  try {
    requireAuthorizedUser();
    const offset = parseInt(e.parameter.offset) || 0;
    const limit = Math.min(parseInt(e.parameter.limit) || 500, 1000);
    
    const sheet = getTicketsSheet();
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const total = lastRow - 1;
    const headers = getCachedHeaders();
    
    const startRow = Math.min(offset + 2, lastRow);
    const numRows = Math.min(limit, lastRow - startRow + 1);
    
    if (numRows <= 0) return createSuccessResponse({ data: [], total, offset, limit });
    
    const data = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
    const rows = data.map((row, i) => {
      const obj = {};
      headers.forEach((h, j) => obj[h] = row[j]);
      obj._rowNum = startRow + i;
      return obj;
    });
    
    return createSuccessResponse({ data: rows, total, offset, limit, hasMore: offset + rows.length < total });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleUpdateOptimized(e, currentUser) {
  try {
    const user = requireAuthorizedUser('staff');
    const rowNum = parseInt(e.parameter.row);
    
    if (!rowNum || rowNum < 2) return createErrorResponse('INVALID_INPUT', { detail: 'Invalid row' });
    
    let values;
    try { values = sanitizeValues(JSON.parse(e.parameter.values)); }
    catch (err) { return createErrorResponse('INVALID_JSON'); }
    
    const sheet = getTicketsSheet();
    const headers = getCachedHeaders();
    const modifiedByIdx = headers.indexOf('Modified_By');
    const modifiedDateIdx = headers.indexOf('Modified_Date');
    const timestamp = new Date().toISOString();
    
    while (values.length < Math.max(modifiedByIdx, modifiedDateIdx) + 1) values.push('');
    if (modifiedByIdx >= 0) values[modifiedByIdx] = user.name;
    if (modifiedDateIdx >= 0) values[modifiedDateIdx] = timestamp;
    
    sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
    logAction('UPDATE', { row: rowNum, ticketNum: values[0], modifiedBy: user.name });
    
    return createSuccessResponse({ message: 'Updated', row: rowNum, modifiedBy: user.name });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleBatchUpdateOptimized(e, currentUser) {
  try {
    const user = requireAuthorizedUser('staff');
    let updates;
    try { updates = JSON.parse(e.parameter.updates); }
    catch (err) { return createErrorResponse('INVALID_JSON'); }
    
    if (!Array.isArray(updates) || !updates.length) {
      return createErrorResponse('INVALID_INPUT', { detail: 'No updates' });
    }
    
    const sheet = getTicketsSheet();
    const headers = getCachedHeaders();
    const modifiedByIdx = headers.indexOf('Modified_By');
    const modifiedDateIdx = headers.indexOf('Modified_Date');
    const timestamp = new Date().toISOString();
    
    updates.sort((a, b) => parseInt(a.row) - parseInt(b.row));
    
    const batches = [];
    let currentBatch = null;
    
    updates.forEach(update => {
      const rowNum = parseInt(update.row);
      if (!rowNum || rowNum < 2 || !update.values) return;
      
      const values = sanitizeValues(update.values.slice());
      while (values.length < Math.max(modifiedByIdx, modifiedDateIdx) + 1) values.push('');
      if (modifiedByIdx >= 0) values[modifiedByIdx] = user.name;
      if (modifiedDateIdx >= 0) values[modifiedDateIdx] = timestamp;
      
      if (!currentBatch || rowNum !== currentBatch.endRow + 1) {
        currentBatch = { startRow: rowNum, endRow: rowNum, data: [values], numCols: values.length };
        batches.push(currentBatch);
      } else {
        currentBatch.endRow = rowNum;
        currentBatch.data.push(values);
        currentBatch.numCols = Math.max(currentBatch.numCols, values.length);
      }
    });
    
    let successCount = 0;
    batches.forEach(batch => {
      batch.data = batch.data.map(row => {
        while (row.length < batch.numCols) row.push('');
        return row;
      });
      sheet.getRange(batch.startRow, 1, batch.data.length, batch.numCols).setValues(batch.data);
      successCount += batch.data.length;
    });
    
    logAction('BATCH_UPDATE', { count: successCount, modifiedBy: user.name });
    return createSuccessResponse({ message: 'Batch update complete', updatedCount: successCount });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleAdd(e, currentUser) {
  try {
    const user = requireAuthorizedUser('staff');
    let values;
    try { values = sanitizeValues(JSON.parse(e.parameter.values)); }
    catch (err) { return createErrorResponse('INVALID_JSON'); }
    
    const sheet = getTicketsSheet();
    const headers = getCachedHeaders();
    const modifiedByIdx = headers.indexOf('Modified_By');
    const modifiedDateIdx = headers.indexOf('Modified_Date');
    
    while (values.length < Math.max(modifiedByIdx, modifiedDateIdx) + 1) values.push('');
    if (modifiedByIdx >= 0) values[modifiedByIdx] = user.name;
    if (modifiedDateIdx >= 0) values[modifiedDateIdx] = new Date().toISOString();
    
    sheet.appendRow(values);
    const newRow = sheet.getLastRow();
    
    logAction('ADD', { row: newRow, ticketNum: values[0], addedBy: user.name });
    return createSuccessResponse({ message: 'Row added', row: newRow });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleDelete(e, currentUser) {
  try {
    const user = requireAuthorizedUser('staff');
    const rowNum = parseInt(e.parameter.row);
    if (!rowNum || rowNum < 2) return createErrorResponse('INVALID_INPUT');
    
    const sheet = getTicketsSheet();
    const headers = getCachedHeaders();
    const statusIdx = headers.indexOf('Status') + 1 || 2;
    
    sheet.getRange(rowNum, statusIdx).setValue('Deleted');
    logAction('DELETE', { row: rowNum, deletedBy: user.name });
    
    return createSuccessResponse({ message: 'Deleted', row: rowNum });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleSearch(e, currentUser) {
  try {
    requireAuthorizedUser();
    const query = sanitizeInput(e.parameter.query || '').toLowerCase();
    if (!query) return createErrorResponse('INVALID_INPUT', { detail: 'No query' });
    
    const sheet = getTicketsSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const results = [];
    
    for (let i = 1; i < data.length; i++) {
      for (let j = 0; j < headers.length; j++) {
        if (String(data[i][j] || '').toLowerCase().includes(query)) {
          const row = {};
          headers.forEach((h, idx) => row[h] = data[i][idx]);
          row._rowNum = i + 1;
          results.push(row);
          break;
        }
      }
    }
    
    return createSuccessResponse({ query, results, count: results.length });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleFuzzySearch(e, currentUser) {
  try {
    requireAuthorizedUser();
    const query = (e.parameter.query || '').toLowerCase();
    const threshold = parseFloat(e.parameter.threshold) || 0.3;
    if (!query) return createErrorResponse('INVALID_INPUT');
    
    const sheet = getTicketsSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const results = [];
    
    for (let i = 1; i < data.length; i++) {
      let bestScore = 0;
      for (let j = 0; j < headers.length; j++) {
        const cellValue = String(data[i][j] || '').toLowerCase();
        const score = cellValue.includes(query) ? 1.0 : fuzzyScore(query, cellValue);
        if (score > bestScore) bestScore = score;
      }
      
      if (bestScore >= threshold) {
        const row = {};
        headers.forEach((h, idx) => row[h] = data[i][idx]);
        row._rowNum = i + 1;
        row._score = bestScore;
        results.push(row);
      }
    }
    
    results.sort((a, b) => b._score - a._score);
    return createSuccessResponse({ query, results: results.slice(0, 50), totalMatches: results.length });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function fuzzyScore(query, target) {
  if (!target) return 0;
  let matches = 0, lastIndex = -1;
  for (const char of query) {
    const idx = target.indexOf(char, lastIndex + 1);
    if (idx > lastIndex) { matches++; lastIndex = idx; }
  }
  return matches / query.length;
}

function handleStats(e, currentUser) {
  try {
    requireAuthorizedUser();
    const sheet = getTicketsSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const statusCol = headers.indexOf('Status');
    
    const stats = { total: data.length - 1, available: 0, sold: 0, reserved: 0, donated: 0, deleted: 0 };
    
    for (let i = 1; i < data.length; i++) {
      const status = String(data[i][statusCol] || '').toLowerCase();
      if (stats.hasOwnProperty(status)) stats[status]++;
    }
    
    stats.revenue = stats.sold * 10;
    return createSuccessResponse({ stats });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleValidateStaff(e, currentUser) {
  try {
    const user = requireAuthorizedUser();
    return createSuccessResponse({ email: user.email, name: user.name, role: user.role, isAuthorized: true });
  } catch (error) {
    return createErrorResponse(error.message, { isAuthorized: false });
  }
}

function handleGetCurrentUser(currentUser) {
  try {
    const user = requireAuthorizedUser();
    return createSuccessResponse({ user: { email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

function handleGetStaffList(e, currentUser) {
  try {
    const user = requireAuthorizedUser('admin');
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STAFF_SHEET_NAME);
    if (!sheet) return createErrorResponse('NOT_FOUND');
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const staffList = data.slice(1).filter(row => row[0]).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (!['Password', 'OTP', 'OTP_Expiry'].includes(h)) obj[h] = row[i];
      });
      return obj;
    });
    
    return createSuccessResponse({ staffList, count: staffList.length });
  } catch (error) {
    return createErrorResponse(error.message);
  }
}

// ============ UTILITY ============

function getTicketsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TICKETS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    if (sheet.getName() === 'Sheet1') {
      sheet.setName(TICKETS_SHEET_NAME);
      invalidateHeaderCache();
    }
  }
  if (!sheet) throw new Error('No tickets sheet');
  return sheet;
}

function logAction(action, details) {
  if (!ENABLE_LOGGING) return;
  Logger.log(JSON.stringify({ timestamp: new Date().toISOString(), action, details }));
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName('_AuditLog');
    if (!logSheet) {
      logSheet = ss.insertSheet('_AuditLog');
      logSheet.appendRow(['Timestamp', 'Action', 'Details', 'Email']);
      logSheet.setFrozenRows(1);
    }
    if (logSheet.getLastRow() > 5001) logSheet.deleteRows(2, logSheet.getLastRow() - 5000);
    logSheet.appendRow([new Date().toISOString(), action, JSON.stringify(details), details.email || '']);
  } catch (e) {}
}

// ============ SETUP ============

function setupAll() {
  setupTicketsSheet();
  setupStaffSheetEnhanced();
  Logger.log('Setup complete!');
}

function setupTicketsSheet() {
  const headers = [
    'Ticket_Number', 'Status', 'Sale_Type', 'Buyer_Name', 'Buyer_Phone',
    'Buyer_Zone', 'Sold_By', 'Payment_Status', 'Payment_Date', 'Book_Number',
    'Donated_To_Education', 'Notes', 'Modified_By', 'Modified_Date'
  ];
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TICKETS_SHEET_NAME) || ss.getSheets()[0];
  if (sheet.getName() === 'Sheet1') sheet.setName(TICKETS_SHEET_NAME);
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1A4B8C').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  invalidateHeaderCache();
}

/**
 * Enhanced Staff sheet with login system columns
 */
function setupStaffSheetEnhanced() {
  const headers = [
    'Email', 'Name', 'Role', 'Active', 'Password', 'Status', 
    'Created_Date', 'Validity_Days', 'OTP', 'OTP_Expiry',
    'Monday_URL', 'Tuesday_URL', 'Wednesday_URL', 'Thursday_URL',
    'Friday_URL', 'Saturday_URL', 'Sunday_URL'
  ];
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(STAFF_SHEET_NAME);
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#8b5cf6').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  
  // Add current user as admin
  const currentUserEmail = Session.getActiveUser().getEmail();
  if (currentUserEmail && sheet.getLastRow() < 2) {
    sheet.appendRow([
      currentUserEmail, 'Admin', 'admin', true, '', 'Approved',
      new Date().toISOString(), 365, '', '',
      '', '', '', '', '', '', ''
    ]);
  }
  
  Logger.log('Staff sheet setup complete with login system columns');
}

function generateSampleData() {
  const sheet = getTicketsSheet();
  if (sheet.getLastRow() < 1) setupTicketsSheet();
  
  const data = [];
  for (let i = 1; i <= 100; i++) {
    data.push([
      'CEAM-' + String(i).padStart(4, '0'), 'Available', '', '', '', '', '', '', '',
      'Book-' + String(Math.ceil(i / 10)).padStart(4, '0'), '', '', '', ''
    ]);
  }
  
  sheet.getRange(sheet.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);
  Logger.log('Generated ' + data.length + ' sample tickets');
}

// ============ TEST FUNCTIONS (Run from Editor) ============

/**
 * Test the setup - run this from the editor to verify everything works
 */
function testSetup() {
  Logger.log('=== CEAM Raffle System Test ===');
  Logger.log('');
  
  // Test 1: Check current user
  try {
    const email = Session.getActiveUser().getEmail();
    Logger.log('✅ Current user: ' + email);
  } catch (e) {
    Logger.log('❌ Cannot get current user: ' + e.message);
  }
  
  // Test 2: Check Tickets sheet
  try {
    const sheet = getTicketsSheet();
    Logger.log('✅ Tickets sheet: ' + sheet.getLastRow() + ' rows');
  } catch (e) {
    Logger.log('❌ Tickets sheet error: ' + e.message);
    Logger.log('   Run setupTicketsSheet() to create it');
  }
  
  // Test 3: Check Staff sheet
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
    if (staffSheet) {
      const headers = staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0];
      Logger.log('✅ Staff sheet: ' + staffSheet.getLastRow() + ' rows');
      Logger.log('   Columns: ' + headers.join(', '));
      
      // Check for new columns
      const hasPassword = headers.includes('Password');
      const hasStatus = headers.includes('Status');
      const hasValidity = headers.includes('Validity_Days');
      const hasDayUrls = headers.includes('Monday_URL');
      
      if (!hasPassword || !hasStatus || !hasValidity) {
        Logger.log('⚠️ Staff sheet missing login columns. Run setupStaffSheetEnhanced()');
      }
      if (!hasDayUrls) {
        Logger.log('⚠️ Staff sheet missing day URL columns. Run setupStaffSheetEnhanced()');
      }
    } else {
      Logger.log('❌ Staff sheet not found');
      Logger.log('   Run setupStaffSheetEnhanced() to create it');
    }
  } catch (e) {
    Logger.log('❌ Staff sheet error: ' + e.message);
  }
  
  // Test 4: Check authorization
  try {
    const user = requireAuthorizedUser();
    Logger.log('✅ Authorization: ' + user.email + ' (' + user.role + ')');
  } catch (e) {
    Logger.log('❌ Authorization failed: ' + e.message);
    if (e.message === 'UNAUTHORIZED') {
      Logger.log('   Add your email to Staff sheet Column A');
    }
  }
  
  Logger.log('');
  Logger.log('=== Test Complete ===');
  Logger.log('');
  Logger.log('To deploy:');
  Logger.log('1. Click Deploy → New deployment');
  Logger.log('2. Type: Web app');
  Logger.log('3. Execute as: Me');
  Logger.log('4. Access: Anyone');
  Logger.log('5. Click Deploy and copy the URL');
}

/**
 * Simulate a login request - run from editor to test login logic
 */
function testLogin() {
  Logger.log('=== Test Login ===');
  
  // Get first staff member from sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
  
  if (!staffSheet || staffSheet.getLastRow() < 2) {
    Logger.log('❌ No staff members found. Run setupStaffSheetEnhanced() first.');
    return;
  }
  
  const data = staffSheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('Email');
  const passwordIdx = headers.indexOf('Password');
  
  const testEmail = data[1][emailIdx];
  Logger.log('Testing with email: ' + testEmail);
  
  // Simulate login request
  const mockEvent = {
    parameter: {
      email: testEmail,
      password: 'test123' // This will fail unless you set this password
    }
  };
  
  const result = handleLogin(mockEvent);
  Logger.log('Result: ' + JSON.stringify(result, null, 2));
  
  if (!result.success) {
    Logger.log('');
    Logger.log('To test login successfully:');
    Logger.log('1. Set a password in Staff sheet Password column');
    Logger.log('2. Or use the register flow to create an account');
  }
}

/**
 * Quick diagnostic - shows system status
 */
function diagnosticCheck() {
  Logger.log('=== CEAM Raffle Diagnostic ===');
  Logger.log('Timestamp: ' + new Date().toISOString());
  Logger.log('');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('ID: ' + ss.getId());
  Logger.log('');
  
  // List all sheets
  Logger.log('Sheets:');
  ss.getSheets().forEach(sheet => {
    Logger.log('  - ' + sheet.getName() + ' (' + sheet.getLastRow() + ' rows)');
  });
  Logger.log('');
  
  // Check deployment URL
  Logger.log('To get your Web App URL:');
  Logger.log('1. Deploy → Manage deployments');
  Logger.log('2. Copy the Web App URL');
  Logger.log('3. Test with: URL?action=ping');
}