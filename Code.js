function updateDropdown() {
  const FORM_ID = '1UTHzL9KNH6TDdK7Bedg_pPYu8rUCLSKn4IzsJEFYOJY';
  const SHEET_ID = '1T33Z8JFRdL9oFZ-6XT_lz-tNIAFKXF2ekp-e-cYm7uc';

  const DROPDOWN_CONFIG = [
    {
      sheetName: 'IT-SD PMS',
      questionTitle: 'IT-SD Asset Tag'
    },
    {
      sheetName: 'IT-IS PMS',
      questionTitle: 'IT-IS Asset Tag'
    }
  ];

  const form = FormApp.openById(FORM_ID);
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);

  DROPDOWN_CONFIG.forEach(config => {
    const sheet = spreadsheet.getSheetByName(config.sheetName);

    if (!sheet) {
      throw new Error('Sheet not found: ' + config.sheetName);
    }

    const lastRow = sheet.getLastRow();

    if (lastRow < 4) {
      updateListQuestionChoices(form, config.questionTitle, []);
      return;
    }

    const values = sheet.getRange(4, 1, lastRow - 3, 2)
      .getValues();

    const inProdAssetTags = values
      .filter(row => {
        const assetTag = String(row[0]).trim();
        const statusOfEquipment = String(row[1]).trim().toUpperCase();

        return assetTag !== '' && statusOfEquipment === 'INPROD';
      })
      .map(row => String(row[0]).trim());

    const uniqueValues = [...new Set(inProdAssetTags)];

    updateListQuestionChoices(form, config.questionTitle, uniqueValues);
  });
}

function updateListQuestionChoices(form, questionTitle, choices) {
  const items = form.getItems(FormApp.ItemType.LIST);

  for (const item of items) {
    const listItem = item.asListItem();

    if (listItem.getTitle().trim() === questionTitle) {
      if (choices.length > 0) {
        listItem.setChoiceValues(choices);
      }

      return;
    }
  }

  throw new Error('Dropdown question not found in Google Form: ' + questionTitle);
}