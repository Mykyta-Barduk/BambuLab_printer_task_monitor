// ====== НАЛАШТУВАННЯ ======
const PARENT_FOLDER_ID = "1q-Q7AUkiu1-hZOTTZ67SpxGh53Ys8j7r-UWKvp9AU14zdBnTVudBZHA1qWAFU7-BQ2_13B6Q";
const SERVER_URL = "url";
// ==========================

function onFormSubmit(e) {
  try {
    if (!e || !e.response) {
      Logger.log("Скрипт запущено вручну. Об'єкт події форми порожній. Для тесту заповніть форму в браузері!");
      return;
    }

    const itemResponses = e.response.getItemResponses();
    const userEmail = e.response.getRespondentEmail();
    
    let quantity = 1;
    let materialType = "PLA";
    let requestedColor = "Any";
    let comment = "";
    let priority = "MEDIUM";
    let fileId = "";

    // Збір відповідей з форми
    for (let i = 0; i < itemResponses.length; i++) {
      const itemResponse = itemResponses[i];
      const title = itemResponse.getItem().getTitle();
      const value = itemResponse.getResponse();

      if (title.includes("Кількість")) quantity = value;
      if (title.includes("Матеріал")) materialType = value;
      if (title.includes("колір")) requestedColor = value;
      if (title.includes("Коментарі")) comment = value;
      
      if (title.includes("Критичність")) {
        if (value.includes("БЛЯХА СРАКА ГОРИТЬ") || value.includes("Постав зараз")) {
          priority = "HIGH";
        } else if (value.includes("Постав як найшвидше")) {
          priority = "MEDIUM";
        } else {
          priority = "LOW";
        }
      }
      
      if (itemResponse.getItem().getType() === FormApp.ItemType.FILE_UPLOAD) {
        if (value && value.length > 0) fileId = value[0];
      }
    }

    const finalEmail = userEmail || "student@kpi.ua";
    const username = finalEmail.split('@')[0];

    let modelName = "unknown_model.stl";
    let gdriveFileLink = "";
    let gdriveFolderLink = "";

    // (Дата -> Користувач)
    if (fileId && PARENT_FOLDER_ID) {
      const file = DriveApp.getFileById(fileId);
      modelName = file.getName();

      // 1. Отримуємо кореневу папку ферми
      const rootFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
      const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
      
      // 2. Шукаємо або створюємо папку з поточною Датою
      let dateFolder;
      const dateFoldersIter = rootFolder.getFoldersByName(dateStr);
      if (dateFoldersIter.hasNext()) {
        dateFolder = dateFoldersIter.next();
      } else {
        dateFolder = rootFolder.createFolder(dateStr);
      }

      // 3. Всередині папки дати шукаємо або створюємо папку Користувача (username)
      let userFolder;
      const userFoldersIter = dateFolder.getFoldersByName(username);
      if (userFoldersIter.hasNext()) {
        userFolder = userFoldersIter.next();
      } else {
        userFolder = dateFolder.createFolder(username);
      }

      // Посилання на папку користувача, де зберігатимуться всі його STL за цей день
      gdriveFolderLink = userFolder.getUrl();

      // 4. Переносимо файл у фінальну папку користувача
      file.moveTo(userFolder);
      gdriveFileLink = file.getUrl();
    }

    // Збираємо пакет для Express API
    const payload = {
      modelName: modelName,
      userEmail: finalEmail,
      priority: priority,
      materialType: materialType,
      requestedColor: requestedColor,
      quantity: parseInt(quantity) || 1,
      comment: comment,
      gdriveFileLink: gdriveFileLink,
      gdriveFolderLink: gdriveFolderLink
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    // Відправка на сервер
    const response = UrlFetchApp.fetch(SERVER_URL, options);
    Logger.log("Відповідь сервера: " + response.getContentText());

  } catch (error) {
    console.error("Помилка виконання скрипта: " + error.toString());
  }
}