var PMS = PMS || {};

PMS.CONFIG = {
  APP_NAME: 'YDC Preventive Maintenance',
  SPREADSHEET_ID: '1T33Z8JFRdL9oFZ-6XT_lz-tNIAFKXF2ekp-e-cYm7uc',
  RESPONSE_SHEET: 'PMS Records',
  INFRA_RESPONSE_SHEET: 'PMS Records - Infra & Security',
  TICKET_SHEET: 'PMS Tickets',
  TICKET_LOG_SHEET: 'PMS Ticket Log',
  // Who receives email notifications, maintained in this sheet rather than in
  // code so the list can change without a deployment.
  NOTIFY_SHEET: 'PMS Notification Recipients',
  // Master switch. Set to false to stop all outbound notifications without
  // emptying the recipients sheet.
  NOTIFY_ENABLED: true,
  NOTIFY_SENDER_NAME: 'YDC PMS',
  NOTIFY_SUBJECT_PREFIX: '[YDC PMS]',
  // Findings tickets are visible to every rostered user regardless of section,
  // because repairing an asset is cross-team work and any user may move a ticket
  // along. Accountability comes from the append-only log rather than from
  // restricting who can act. Set to 'OWN_SECTION' to limit the list to the
  // viewer's own section instead.
  TICKET_VISIBILITY: 'ALL_SECTIONS',
  ALLOWED_DOMAIN: 'ydc.com.ph',
  TIME_ZONE: 'Asia/Manila',
  SCHEMA_VERSION: '2.0.0',
  ASSET_HEADER_ROW: 3,
  ASSET_DATA_START_ROW: 4,
  TRACKER_YEAR_ROW: 2,
  TRACKER_YEAR_COLUMN: 4,
  TRACKER_COMPLETED_VALUE: 'COMPLETED',
  /*
    Values the application may write into a tracker cycle status cell.

    Maintenance that found nothing outstanding stays COMPLETED, which is what
    every existing row already contains. When the maintenance raised a findings
    ticket, the cell carries that repair's state instead, so the tracker answers
    "is anything still outstanding on this asset" without opening the app.
    A closed ticket returns the cell to COMPLETED.

    All of these mean the asset WAS maintained this cycle. PMS.Util.isTrackerComplete
    treats them as such, otherwise the questionnaire would offer the asset again.
  */
  TRACKER_REPAIR_VALUES: Object.freeze({
    OPEN: 'FOR FIXING',
    IN_PROGRESS: 'IN PROGRESS',
    ON_HOLD: 'ON HOLD'
  }),
  CACHE_SECONDS: 300,
  ROLLOVER_TOKEN_SECONDS: 300,
  LEGACY_IMPORT_TOKEN_SECONDS: 1800,
  LEGACY_IMPORT_MAX_TAGS: 1500,
  LEGACY_IMPORT_CHUNK_SIZE: 250,
  // Sign-in requires the signed-in Google account email to exist in the
  // "PMS Users" sheet. Set to false to allow any allowed-domain account to
  // self-register instead.
  REQUIRE_DIRECTORY_ENTRY: true,
  // Controls which assets the questionnaire's asset picker hides as already
  // completed, based on the T1/T2/T3 status cells in the section tracker sheet.
  //   ANY_CYCLE     - hide once T1, T2, or T3 is COMPLETED for the tracker year.
  //   CURRENT_CYCLE - hide only for the cycle being worked on, so an asset
  //                   completed in T1 is still offered in T2 and T3.
  // This affects the picker only. Dashboard eligibility and compliance always
  // count every INPROD asset.
  ASSET_PICKER_COMPLETION_SCOPE: 'CURRENT_CYCLE',
  MAX_TEXT_LENGTH: 5000,
  MAX_REMARKS_CELL_LENGTH: 49000,
  MAX_EVIDENCE_BYTES: 10 * 1024 * 1024,
  EVIDENCE_SIGNING_SECRET_PROPERTY: 'PMS_EVIDENCE_SIGNING_SECRET',
  // Static bootstrap allowlist. Additional administrators may be stored in the
  // private PMS_ADMIN_EMAILS Script Property after initial setup.
  ADMIN_EMAILS: ['itdept@ydc.com.ph'],
  ADMIN_EMAILS_PROPERTY: 'PMS_ADMIN_EMAILS',
  PROFILE_PROPERTY_PREFIX: 'PMS_USER_',
  ROLLOVER_STATE_PROPERTY: 'PMS_ROLLOVER_STATE',
  RECONCILIATION_STATE_PROPERTY: 'PMS_RECONCILIATION_STATE',
  BASELINE_PROPERTY_PREFIX: 'PMS_TRACKER_BASELINE_',
  SECTIONS: Object.freeze({
    SERVICE_DESK: Object.freeze({
      key: 'SERVICE_DESK',
      label: 'Service Desk',
      sheetName: 'IT-SD PMS'
    }),
    INFRA_SECURITY: Object.freeze({
      key: 'INFRA_SECURITY',
      label: 'Infrastructure & Security',
      sheetName: 'IT-IS PMS'
    })
  }),
  CYCLES: Object.freeze({
    // checkboxColumn is retained as a compatibility key for existing records
    // and the obsolete-lock cleanup; the live cells now contain status text.
    T1: Object.freeze({ key: 'T1', startMonth: 1, endMonth: 4, endDay: 30, checkboxColumn: 4, remarksColumn: 5 }),
    T2: Object.freeze({ key: 'T2', startMonth: 5, endMonth: 8, endDay: 31, checkboxColumn: 6, remarksColumn: 7 }),
    T3: Object.freeze({ key: 'T3', startMonth: 9, endMonth: 12, endDay: 31, checkboxColumn: 8, remarksColumn: 9 })
  }),
  PERIPHERALS: Object.freeze([
    Object.freeze({ key: 'nuc', label: 'NUC' }),
    Object.freeze({ key: 'nucAdaptor', label: 'NUC Adaptor' }),
    Object.freeze({ key: 'monitor', label: 'Monitor' }),
    Object.freeze({ key: 'keyboard', label: 'Keyboard' }),
    Object.freeze({ key: 'mouse', label: 'Mouse' }),
    Object.freeze({ key: 'ups', label: 'UPS' }),
    Object.freeze({ key: 'powerAdaptor', label: 'Power Adaptor' }),
    Object.freeze({ key: 'headset', label: 'Headset' }),
    Object.freeze({ key: 'typeCAdaptor', label: 'Type-C Adaptor' }),
    Object.freeze({ key: 'webcam', label: 'Webcam' })
  ]),
  INFRA_ASSET_TYPES: Object.freeze([
    'Switch',
    'Firewall',
    'Access Point',
    'OMADA Controller',
    'Server',
    'FortiAnalyzer'
  ]),
  INFRA_ASSET_TYPE_BY_TAG_PREFIX: Object.freeze({
    SW: 'Switch',
    FW: 'Firewall',
    AP: 'Access Point',
    SVR: 'Server'
  }),
  EVIDENCE: Object.freeze({
    firmware: Object.freeze({
      key: 'firmware',
      label: 'Latest Firmware Version Evidence',
      folderId: '1_YwagxFnBU8M6Yx6Ilr8oy8JFGClgw9I4O7zHQ-K0vsbgVUGCISKjjDNO8TiB23GlY0HHJ47',
      recordPrefix: 'firmwareEvidence'
    }),
    backup: Object.freeze({
      key: 'backup',
      label: 'Configurations / Backup / Checkpoints Evidence',
      folderId: '1IuRmXoTM7pctSvEe6489RP9hgA-AbcXNoeJI_o4IhPeSHT8Bk14ZjiRCitU972lczPpLAojg',
      recordPrefix: 'backupEvidence'
    })
  }),
  INFRA_CHECKLIST: Object.freeze([
    Object.freeze({
      key: 'physical',
      label: 'Physical Checking',
      items: Object.freeze([
        Object.freeze({ key: 'infraPowerCables', label: 'Power Cables Checked', allowsNa: false }),
        Object.freeze({ key: 'infraDataCables', label: 'Data Cables Checked', allowsNa: false }),
        Object.freeze({ key: 'infraPowerSupplyUps', label: 'Power Supply / UPS Checked', allowsNa: false })
      ])
    }),
    Object.freeze({
      key: 'digital',
      label: 'Digital Checking',
      items: Object.freeze([
        Object.freeze({ key: 'infraFirmwareLatest', label: 'Firmware Version at latest', allowsNa: false })
      ])
    })
  ]),
  CHECKLIST: Object.freeze([
    Object.freeze({
      key: 'hardware',
      label: 'Hardware Inspection',
      items: Object.freeze([
        Object.freeze({ key: 'hardwarePhysicalInspection', label: 'Physical inspection completed', allowsNa: false }),
        Object.freeze({ key: 'hardwareDisplay', label: 'Display checked', allowsNa: false }),
        Object.freeze({ key: 'hardwareKeyboardMouse', label: 'Keyboard and mouse checked', allowsNa: false }),
        Object.freeze({ key: 'hardwarePorts', label: 'Ports tested', allowsNa: false }),
        Object.freeze({ key: 'hardwareBatteryCharger', label: 'Battery and charger checked', allowsNa: true }),
        Object.freeze({ key: 'hardwareCameraAudio', label: 'Camera and audio checked', allowsNa: false })
      ])
    }),
    Object.freeze({
      key: 'system',
      label: 'System Health',
      items: Object.freeze([
        Object.freeze({ key: 'systemOsUpdated', label: 'Operating system updated', allowsNa: false }),
        Object.freeze({ key: 'systemStorage', label: 'Storage checked', allowsNa: false }),
        Object.freeze({ key: 'systemPerformance', label: 'Performance checked', allowsNa: false }),
        Object.freeze({ key: 'systemStartup', label: 'Startup verified', allowsNa: false })
      ])
    }),
    Object.freeze({
      key: 'security',
      label: 'Security Controls',
      items: Object.freeze([
        Object.freeze({ key: 'securityAntivirus', label: 'Antivirus verified', allowsNa: false }),
        Object.freeze({ key: 'securityFirewall', label: 'Firewall verified', allowsNa: false }),
        Object.freeze({ key: 'securityDiskEncryption', label: 'Disk encryption verified', allowsNa: true }),
        Object.freeze({ key: 'securityScreenLock', label: 'Screen lock verified', allowsNa: false })
      ])
    }),
    Object.freeze({
      key: 'network',
      label: 'Network Connectivity',
      items: Object.freeze([
        Object.freeze({ key: 'networkEthernet', label: 'Ethernet port tested', allowsNa: false }),
        Object.freeze({ key: 'networkWifi', label: 'Wi-Fi adapter checked', allowsNa: false })
      ])
    }),
    Object.freeze({
      key: 'applications',
      label: 'Required Applications',
      items: Object.freeze([
        Object.freeze({ key: 'applicationsRequiredSoftware', label: 'Required software verified', allowsNa: false })
      ])
    }),
    Object.freeze({
      key: 'maintenance',
      label: 'Maintenance and Cleaning',
      items: Object.freeze([
        Object.freeze({ key: 'maintenanceTemporaryFiles', label: 'Temporary files cleaned', allowsNa: false }),
        Object.freeze({ key: 'maintenanceDeviceCleaned', label: 'Device cleaned', allowsNa: false }),
        Object.freeze({ key: 'maintenanceHealthCheck', label: 'Health check completed', allowsNa: false })
      ])
    })
  ]),
  ASSESSMENT_RESULTS: Object.freeze(['No findings', 'Findings resolved', 'Follow-up required'])
};

PMS.CONFIG.RECORD_COLUMNS = Object.freeze([
  { key: 'recordId', label: 'Record ID' },
  { key: 'recordType', label: 'Record Type' },
  { key: 'schemaVersion', label: 'Schema Version' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'updatedAt', label: 'Updated At' },
  { key: 'submittedAt', label: 'Submitted At' },
  { key: 'idempotencyKey', label: 'Idempotency Key' },
  { key: 'technicianName', label: 'Technician Name' },
  { key: 'technicianEmail', label: 'Technician Email' },
  { key: 'itSection', label: 'IT Section' },
  { key: 'maintenanceDate', label: 'Maintenance Performed On' },
  { key: 'maintenanceYear', label: 'Maintenance Year' },
  { key: 'cycle', label: 'PMS Cycle' },
  { key: 'cycleId', label: 'Cycle ID' },
  { key: 'cycleDeadline', label: 'Cycle Deadline' },
  { key: 'sourceSheet', label: 'Source Sheet' },
  { key: 'sourceRow', label: 'Source Row' },
  { key: 'assetTag', label: 'Asset Tag' },
  { key: 'assetStatus', label: 'Asset Status' },
  { key: 'masterLocation', label: 'Master Location' },
  { key: 'observedLocation', label: 'Observed Location' },
  { key: 'locationDiscrepancy', label: 'Location Discrepancy' },
  { key: 'peripheralNuc', label: 'Peripheral - NUC' },
  { key: 'peripheralNucAdaptor', label: 'Peripheral - NUC Adaptor' },
  { key: 'peripheralMonitor', label: 'Peripheral - Monitor' },
  { key: 'peripheralKeyboard', label: 'Peripheral - Keyboard' },
  { key: 'peripheralMouse', label: 'Peripheral - Mouse' },
  { key: 'peripheralUps', label: 'Peripheral - UPS' },
  { key: 'peripheralPowerAdaptor', label: 'Peripheral - Power Adaptor' },
  { key: 'peripheralHeadset', label: 'Peripheral - Headset' },
  { key: 'peripheralTypeCAdaptor', label: 'Peripheral - Type-C Adaptor' },
  { key: 'peripheralWebcam', label: 'Peripheral - Webcam' },
  { key: 'hardwarePhysicalInspection', label: 'Hardware - Physical Inspection' },
  { key: 'hardwareDisplay', label: 'Hardware - Display' },
  { key: 'hardwareKeyboardMouse', label: 'Hardware - Keyboard & Mouse' },
  { key: 'hardwarePorts', label: 'Hardware - Ports' },
  { key: 'hardwareBatteryCharger', label: 'Hardware - Battery/Charger' },
  { key: 'hardwareCameraAudio', label: 'Hardware - Camera & Audio' },
  { key: 'systemOsUpdated', label: 'System - OS Updated' },
  { key: 'systemStorage', label: 'System - Storage' },
  { key: 'systemPerformance', label: 'System - Performance' },
  { key: 'systemStartup', label: 'System - Startup' },
  { key: 'securityAntivirus', label: 'Security - Antivirus' },
  { key: 'securityFirewall', label: 'Security - Firewall' },
  { key: 'securityDiskEncryption', label: 'Security - Disk Encryption' },
  { key: 'securityScreenLock', label: 'Security - Screen Lock' },
  { key: 'networkEthernet', label: 'Network - Ethernet' },
  { key: 'networkWifi', label: 'Network - Wi-Fi' },
  { key: 'applicationsRequiredSoftware', label: 'Applications - Required Software' },
  { key: 'maintenanceTemporaryFiles', label: 'Maintenance - Temporary Files' },
  { key: 'maintenanceDeviceCleaned', label: 'Maintenance - Device Cleaned' },
  { key: 'maintenanceHealthCheck', label: 'Maintenance - Health Check' },
  { key: 'assessmentResult', label: 'Assessment Result' },
  { key: 'assetFindings', label: 'Asset Findings' },
  { key: 'actionTaken', label: 'Action Taken' },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'completedItems', label: 'Completed Items' },
  { key: 'applicableItems', label: 'Applicable Items' },
  { key: 'completionPercent', label: 'Completion Percent' },
  { key: 'trackerSheet', label: 'Tracker Sheet' },
  { key: 'trackerRow', label: 'Tracker Row' },
  { key: 'trackerYear', label: 'Tracker Year' },
  { key: 'trackerCycle', label: 'Tracker Cycle' },
  { key: 'previousTrackerCheckbox', label: 'Previous Tracker Checkbox' },
  { key: 'previousTrackerRemarks', label: 'Previous Tracker Remarks' },
  { key: 'trackerSyncedAt', label: 'Tracker Synced At' },
  { key: 'syncError', label: 'Sync Error' },
  { key: 'reinspectionOf', label: 'Reinspection Of' },
  { key: 'dataQualityFlags', label: 'Data Quality Flags' },
  { key: 'pmsCompletion', label: 'PMS Completion' }
]);

PMS.CONFIG.PERIPHERAL_RECORD_KEYS = Object.freeze({
  nuc: 'peripheralNuc',
  nucAdaptor: 'peripheralNucAdaptor',
  monitor: 'peripheralMonitor',
  keyboard: 'peripheralKeyboard',
  mouse: 'peripheralMouse',
  ups: 'peripheralUps',
  powerAdaptor: 'peripheralPowerAdaptor',
  headset: 'peripheralHeadset',
  typeCAdaptor: 'peripheralTypeCAdaptor',
  webcam: 'peripheralWebcam'
});

PMS.CONFIG.INFRA_RECORD_COLUMNS = Object.freeze([
  { key: 'recordId', label: 'Record ID' },
  { key: 'recordType', label: 'Record Type' },
  { key: 'schemaVersion', label: 'Schema Version' },
  { key: 'formType', label: 'Form Type' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'updatedAt', label: 'Updated At' },
  { key: 'submittedAt', label: 'Submitted At' },
  { key: 'idempotencyKey', label: 'Idempotency Key' },
  { key: 'technicianName', label: 'Technician Name' },
  { key: 'technicianEmail', label: 'Technician Email' },
  { key: 'itSection', label: 'IT Section' },
  { key: 'maintenanceDate', label: 'Maintenance Performed On' },
  { key: 'maintenanceYear', label: 'Maintenance Year' },
  { key: 'cycle', label: 'PMS Cycle' },
  { key: 'cycleId', label: 'Cycle ID' },
  { key: 'cycleDeadline', label: 'Cycle Deadline' },
  { key: 'sourceSheet', label: 'Source Sheet' },
  { key: 'sourceRow', label: 'Source Row' },
  { key: 'assetType', label: 'IT-IS Asset Type' },
  { key: 'assetTag', label: 'Asset Tag' },
  { key: 'assetStatus', label: 'Asset Status' },
  { key: 'masterLocation', label: 'Master Location' },
  { key: 'observedLocation', label: 'Observed Location' },
  { key: 'locationDiscrepancy', label: 'Location Discrepancy' },
  { key: 'infraPowerCables', label: 'Physical - Power Cables Checked' },
  { key: 'infraDataCables', label: 'Physical - Data Cables Checked' },
  { key: 'infraPowerSupplyUps', label: 'Physical - Power Supply / UPS Checked' },
  { key: 'infraFirmwareLatest', label: 'Digital - Firmware Version at Latest' },
  { key: 'firmwareEvidenceFileId', label: 'Firmware Evidence - File ID' },
  { key: 'firmwareEvidenceFileName', label: 'Firmware Evidence - File Name' },
  { key: 'firmwareEvidenceUrl', label: 'Firmware Evidence - URL' },
  { key: 'firmwareEvidenceMimeType', label: 'Firmware Evidence - MIME Type' },
  { key: 'firmwareEvidenceSizeBytes', label: 'Firmware Evidence - Size Bytes' },
  { key: 'firmwareEvidenceSha256', label: 'Firmware Evidence - SHA-256' },
  { key: 'firmwareEvidenceUploadedAt', label: 'Firmware Evidence - Uploaded At' },
  { key: 'firmwareEvidenceUploadedBy', label: 'Firmware Evidence - Uploaded By' },
  { key: 'backupEvidenceFileId', label: 'Backup Evidence - File ID' },
  { key: 'backupEvidenceFileName', label: 'Backup Evidence - File Name' },
  { key: 'backupEvidenceUrl', label: 'Backup Evidence - URL' },
  { key: 'backupEvidenceMimeType', label: 'Backup Evidence - MIME Type' },
  { key: 'backupEvidenceSizeBytes', label: 'Backup Evidence - Size Bytes' },
  { key: 'backupEvidenceSha256', label: 'Backup Evidence - SHA-256' },
  { key: 'backupEvidenceUploadedAt', label: 'Backup Evidence - Uploaded At' },
  { key: 'backupEvidenceUploadedBy', label: 'Backup Evidence - Uploaded By' },
  { key: 'assessmentResult', label: 'Assessment Result' },
  { key: 'assetFindings', label: 'Asset Findings' },
  { key: 'actionTaken', label: 'Action Taken' },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'completedItems', label: 'Completed Items' },
  { key: 'applicableItems', label: 'Applicable Items' },
  { key: 'completionPercent', label: 'Completion Percent' },
  { key: 'trackerSheet', label: 'Tracker Sheet' },
  { key: 'trackerRow', label: 'Tracker Row' },
  { key: 'trackerYear', label: 'Tracker Year' },
  { key: 'trackerCycle', label: 'Tracker Cycle' },
  { key: 'previousTrackerCheckbox', label: 'Previous Tracker Checkbox' },
  { key: 'previousTrackerRemarks', label: 'Previous Tracker Remarks' },
  { key: 'trackerSyncedAt', label: 'Tracker Synced At' },
  { key: 'syncError', label: 'Sync Error' },
  { key: 'reinspectionOf', label: 'Reinspection Of' },
  { key: 'dataQualityFlags', label: 'Data Quality Flags' },
  { key: 'pmsCompletion', label: 'PMS Completion' }
]);

Object.freeze(PMS.CONFIG);
