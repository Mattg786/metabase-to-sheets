/**
 * Menu and sidebar entry points for the Metabase to Sheets add-on.
 * These names are called by Google Sheets and by the sidebar.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Metabase to Sheets')
    .addItem('Open', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Metabase to Sheets')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

function toPublicError(error, secrets) {
  var message = scrubSecrets(error && error.message ? error.message : '', secrets || []);
  return { ok: false, error: message || 'The request failed.' };
}

function getSidebarState() {
  return buildSidebarState(createGoogleServices());
}

function savedKey(services) {
  try {
    return services.store.getApiKey();
  } catch (error) {
    return '';
  }
}

function savedLicenceKey(services) {
  try {
    return services.store.getLicenceKey();
  } catch (error) {
    return '';
  }
}

function saveSettings(form) {
  var services = createGoogleServices();
  try {
    return saveSettingsForUser(form || {}, services);
  } catch (error) {
    return toPublicError(error, [form && form.apiKey, form && form.licenceKey, savedKey(services), savedLicenceKey(services)]);
  }
}

function syncNow(form) {
  var services = createGoogleServices();
  try {
    return syncNowForUser(form || {}, services);
  } catch (error) {
    return toPublicError(error, [form && form.apiKey, form && form.licenceKey, savedKey(services), savedLicenceKey(services)]);
  }
}

function loadQuestions(form) {
  var services = createGoogleServices();
  try {
    return loadQuestionsForUser(form || {}, services);
  } catch (error) {
    return toPublicError(error, [form && form.apiKey, savedKey(services)]);
  }
}

function runScheduledSync() {
  var services = createGoogleServices();
  try {
    runScheduledSyncForUser(services);
  } catch (error) {
    throw new Error(toPublicError(error, [services.store.getApiKey(), services.store.getLicenceKey()]).error);
  }
}
