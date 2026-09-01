/**
 * Interface translations.
 *
 * Static markup is translated through `data-i18n` attributes; anything built at
 * runtime calls `t()`. Only the interface is translated — course titles, lesson
 * names and the audio itself are the learner's own content and are left alone.
 */

const STRINGS = {
  en: {
    'app.title': 'Assimil Player',

    /* Welcome ----------------------------------------------------------- */
    'welcome.heading': 'Choose a course',
    'welcome.deviceLine': 'Playing on <strong id="device-name-label">{device}</strong>. Listening history is kept separately on each device.',
    'welcome.emptyTitle': 'No courses yet',
    'welcome.emptyBody': 'Create a course such as <em>Le Portugais</em>, <em>Le Japonais sans Peine</em> or <em>Le Luxembourgeois Facile</em>, then load its MP3 files from this device. Everything is stored offline — no internet needed to listen.',
    'welcome.addLanguage': '+ Add a course',
    'welcome.storage': '{used} stored on this device of about {quota} available',
    'welcome.storagePlain': 'Audio is stored on this device.',
    'welcome.storageProtected': ' · protected from cleanup',
    'welcome.errorTitle': 'The library could not be opened',
    'welcome.retry': 'Try again',
    'aria.settings': 'Settings',

    /* Course ------------------------------------------------------------ */
    'course.addFiles': '+ Add MP3 files',
    'course.addFolder': '+ Add a folder',
    'course.continue': 'Continue where I left off',
    'course.emptyTitle': 'No audio yet',
    'course.emptyBody': 'Add the MP3 files for this course. They are copied into the app so they play with no connection.',
    'course.progress': '{played} of {total} lessons played on {device}',
    'course.progressTotal': ' · {duration} total',
    'course.noAudio': 'No audio loaded yet.',
    'course.lessons': '{count} lessons',
    'course.playedCount': '{played} of {total} played',
    'aria.backToLanguages': 'Back to courses',
    'aria.skipBackShort': 'Skip backward',
    'aria.skipForwardShort': 'Skip forward',
    'aria.courseOptions': 'Course options',
    'aria.markPlayed': 'Mark as played',
    'aria.markNotPlayed': 'Mark as not played',
    'aria.removeTrack': 'Remove {title}',

    /* Track meta -------------------------------------------------------- */
    'meta.played': 'played',
    'meta.playedTimes': 'played {count}×',
    'meta.resumeAt': 'resume at {time}',
    'date.today': 'today',
    'date.yesterday': 'yesterday',
    'date.daysAgo': '{count} days ago',

    /* Player ------------------------------------------------------------ */
    'player.nothing': 'Nothing playing',
    'player.pickLesson': 'Pick a lesson to begin',
    'player.lessonOf': 'Lesson {index} of {total}',
    'player.repeat': 'Repeat',
    'player.break': 'Break',
    'player.back': 'Back',
    'player.forward': 'Forward',
    'player.speed': 'Speed',
    'player.sleep': 'Sleep',
    'player.stop': 'Stop',
    'player.autoNext': 'Auto-next',
    'player.reset': 'Reset',
    'player.off': 'Off',
    'player.playOf': 'Play {pass} of {total}',
    'player.repeating': 'Repeating · play {pass}',
    'player.breakIn': 'Break · next play in {seconds}s',
    'player.sleepIn': 'Sleep in {time}',
    'aria.backToLessons': 'Back to lessons',
    'aria.previousLesson': 'Previous lesson',
    'aria.nextLesson': 'Next lesson',
    'aria.play': 'Play',
    'aria.pause': 'Pause',
    'aria.playPause': 'Play or pause',
    'aria.skipBack': 'Skip back {seconds} seconds',
    'aria.skipForward': 'Skip forward {seconds} seconds',
    'aria.seek': 'Seek',

    /* Course dialog ----------------------------------------------------- */
    'dialog.addLanguage': 'Add a course',
    'dialog.editLanguage': 'Edit course',
    'dialog.cover': 'Cover picture',
    'dialog.optional': '(optional)',
    'dialog.choosePicture': 'Choose picture',
    'dialog.changePicture': 'Change picture',
    'dialog.removePicture': 'Remove',
    'dialog.titleField': 'Title',
    'dialog.subtitleField': 'Subtitle',
    'dialog.subtitlePlaceholder': 'Volume 1 — lessons 1 to 50',
    'dialog.cancel': 'Cancel',
    'dialog.save': 'Save',
    'dialog.done': 'Done',
    'dialog.close': 'Close',

    /* Settings ---------------------------------------------------------- */
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.orientation': 'Screen orientation',
    'orientation.auto': 'Auto',
    'orientation.portrait': 'Portrait',
    'orientation.landscape': 'Landscape',
    'settings.deviceName': 'Name of this device',
    'settings.deviceNote': 'Progress is stored on this device only. Naming it makes the listening report easier to read when you use several devices.',
    'settings.export': 'Export listening report',
    'settings.protect': 'Protect offline files',
    'settings.usage': 'Using {used}{quota}. ',
    'settings.usageOf': ' of ~{quota}',
    'settings.protectedYes': 'Storage is protected.',
    'settings.protectedNo': 'Storage is not yet protected.',

    /* Course options ---------------------------------------------------- */
    'menu.title': 'Course options',
    'menu.rename': 'Edit name and picture',
    'menu.resetProgress': 'Reset progress on this device',
    'menu.delete': 'Delete course and its audio',

    /* Messages ---------------------------------------------------------- */
    'toast.addFilesFirst': 'Add some audio first.',
    'toast.noAudioFound': 'No audio files found in that selection.',
    'toast.alreadyAdded': 'Those files are already on this device.',
    'toast.added': 'Added {count} lessons.',
    'toast.addedOne': 'Added 1 lesson.',
    'toast.importFailed': 'Import failed.',
    'toast.copying': 'Copying {name}',
    'toast.copyingTitle': 'Copying audio to this device…',
    'toast.trackRemoved': 'Lesson removed.',
    'toast.courseRenamed': 'Course renamed.',
    'toast.courseUpdated': 'Course updated.',
    'toast.courseDeleted': 'Course deleted.',
    'toast.nowAddFiles': 'Now add the MP3 files for this course.',
    'toast.progressReset': 'Progress reset on this device.',
    'toast.pictureFailed': 'That picture could not be used.',
    'toast.reportSaved': 'Listening report saved.',
    'toast.protectedOk': 'Offline files are protected from cleanup.',
    'toast.protectedNo': 'The browser did not grant protected storage. Install the app to improve the odds.',
    'toast.repeatOff': 'Repeat off.',
    'toast.repeatInf': 'This lesson will repeat until you stop it.',
    'toast.repeatTimes': 'This lesson will play {count} times in a row.',
    'toast.breakOff': 'No break between repeats.',
    'toast.breakOn': '{seconds} second break between repeats.',
    'toast.sleepOff': 'Sleep timer switched off.',
    'toast.sleepOn': 'Playback will fade out and stop in {minutes} minutes.',
    'toast.sleepFired': 'Sleep timer finished — playback stopped.',
    'toast.controlsReset': 'Controls reset to their defaults.',
    'toast.orientationAuto': 'The screen now follows the device.',
    'toast.orientationLocked': 'Screen locked to {mode}.',
    'toast.orientationNeedsApp': 'Locking the screen only works in the installed app. It will apply once you install it.',
    'toast.playFailed': '"{title}" could not be played. Try removing it and adding the file again.',
    'confirm.removeTrack': 'Remove "{title}" from this device?',
    'confirm.resetProgress': 'Reset listening progress for "{title}" on {device}?',
    'confirm.deleteCourse': 'Delete "{title}" and all of its audio from this device?',
  },

  fr: {
    'app.title': 'Assimil Player',

    /* Accueil ----------------------------------------------------------- */
    'welcome.heading': 'Choisissez un cours',
    'welcome.deviceLine': 'Lecture sur <strong id="device-name-label">{device}</strong>. L’historique d’écoute est conservé séparément sur chaque appareil.',
    'welcome.emptyTitle': 'Aucun cours pour l’instant',
    'welcome.emptyBody': 'Créez un cours comme <em>Le Portugais</em>, <em>Le Japonais sans Peine</em> ou <em>Le Luxembourgeois Facile</em>, puis chargez ses fichiers MP3 depuis cet appareil. Tout est stocké hors ligne — aucune connexion n’est nécessaire pour écouter.',
    'welcome.addLanguage': '+ Ajouter un cours',
    'welcome.storage': '{used} utilisés sur cet appareil, environ {quota} disponibles',
    'welcome.storagePlain': 'L’audio est stocké sur cet appareil.',
    'welcome.storageProtected': ' · protégé contre le nettoyage',
    'welcome.errorTitle': 'Impossible d’ouvrir la bibliothèque',
    'welcome.retry': 'Réessayer',
    'aria.settings': 'Réglages',

    /* Cours ------------------------------------------------------------- */
    'course.addFiles': '+ Ajouter des fichiers MP3',
    'course.addFolder': '+ Ajouter un dossier',
    'course.continue': 'Reprendre où j’en étais',
    'course.emptyTitle': 'Aucun audio pour l’instant',
    'course.emptyBody': 'Ajoutez les fichiers MP3 de ce cours. Ils sont copiés dans l’application afin d’être lus sans connexion.',
    'course.progress': '{played} sur {total} leçons écoutées sur {device}',
    'course.progressTotal': ' · {duration} au total',
    'course.noAudio': 'Aucun audio chargé pour l’instant.',
    'course.lessons': '{count} leçons',
    'course.playedCount': '{played} sur {total} écoutées',
    'aria.backToLanguages': 'Retour aux cours',
    'aria.skipBackShort': 'Reculer',
    'aria.skipForwardShort': 'Avancer',
    'aria.courseOptions': 'Options du cours',
    'aria.markPlayed': 'Marquer comme écoutée',
    'aria.markNotPlayed': 'Marquer comme non écoutée',
    'aria.removeTrack': 'Supprimer {title}',

    /* Détails des leçons ------------------------------------------------ */
    'meta.played': 'écoutée',
    'meta.playedTimes': 'écoutée {count} fois',
    'meta.resumeAt': 'reprise à {time}',
    'date.today': 'aujourd’hui',
    'date.yesterday': 'hier',
    'date.daysAgo': 'il y a {count} jours',

    /* Lecteur ----------------------------------------------------------- */
    'player.nothing': 'Aucune lecture',
    'player.pickLesson': 'Choisissez une leçon pour commencer',
    'player.lessonOf': 'Leçon {index} sur {total}',
    'player.repeat': 'Répétition',
    'player.break': 'Pause',
    'player.back': 'Retour',
    'player.forward': 'Avance',
    'player.speed': 'Vitesse',
    'player.sleep': 'Minuterie',
    'player.stop': 'Arrêt',
    'player.autoNext': 'Suite auto',
    'player.reset': 'Réinitialiser',
    'player.off': 'Aucune',
    'player.playOf': 'Lecture {pass} sur {total}',
    'player.repeating': 'En boucle · lecture {pass}',
    'player.breakIn': 'Pause · reprise dans {seconds} s',
    'player.sleepIn': 'Arrêt dans {time}',
    'aria.backToLessons': 'Retour aux leçons',
    'aria.previousLesson': 'Leçon précédente',
    'aria.nextLesson': 'Leçon suivante',
    'aria.play': 'Lecture',
    'aria.pause': 'Pause',
    'aria.playPause': 'Lecture ou pause',
    'aria.skipBack': 'Reculer de {seconds} secondes',
    'aria.skipForward': 'Avancer de {seconds} secondes',
    'aria.seek': 'Position',

    /* Boîte de dialogue du cours ---------------------------------------- */
    'dialog.addLanguage': 'Ajouter un cours',
    'dialog.editLanguage': 'Modifier le cours',
    'dialog.cover': 'Image de couverture',
    'dialog.optional': '(facultatif)',
    'dialog.choosePicture': 'Choisir une image',
    'dialog.changePicture': 'Changer l’image',
    'dialog.removePicture': 'Supprimer',
    'dialog.titleField': 'Titre',
    'dialog.subtitleField': 'Sous-titre',
    'dialog.subtitlePlaceholder': 'Volume 1 — leçons 1 à 50',
    'dialog.cancel': 'Annuler',
    'dialog.save': 'Enregistrer',
    'dialog.done': 'Terminé',
    'dialog.close': 'Fermer',

    /* Réglages ---------------------------------------------------------- */
    'settings.title': 'Réglages',
    'settings.language': 'Langue',
    'settings.orientation': 'Orientation de l’écran',
    'orientation.auto': 'Auto',
    'orientation.portrait': 'Portrait',
    'orientation.landscape': 'Paysage',
    'settings.deviceName': 'Nom de cet appareil',
    'settings.deviceNote': 'La progression est enregistrée uniquement sur cet appareil. Lui donner un nom rend le rapport d’écoute plus clair si vous utilisez plusieurs appareils.',
    'settings.export': 'Exporter le rapport d’écoute',
    'settings.protect': 'Protéger les fichiers hors ligne',
    'settings.usage': 'Utilisation : {used}{quota}. ',
    'settings.usageOf': ' sur environ {quota}',
    'settings.protectedYes': 'Le stockage est protégé.',
    'settings.protectedNo': 'Le stockage n’est pas encore protégé.',

    /* Options du cours -------------------------------------------------- */
    'menu.title': 'Options du cours',
    'menu.rename': 'Modifier le nom et l’image',
    'menu.resetProgress': 'Réinitialiser la progression sur cet appareil',
    'menu.delete': 'Supprimer le cours et son audio',

    /* Messages ---------------------------------------------------------- */
    'toast.addFilesFirst': 'Ajoutez d’abord de l’audio.',
    'toast.noAudioFound': 'Aucun fichier audio trouvé dans cette sélection.',
    'toast.alreadyAdded': 'Ces fichiers sont déjà sur cet appareil.',
    'toast.added': '{count} leçons ajoutées.',
    'toast.addedOne': '1 leçon ajoutée.',
    'toast.importFailed': 'L’importation a échoué.',
    'toast.copying': 'Copie de {name}',
    'toast.copyingTitle': 'Copie de l’audio sur cet appareil…',
    'toast.trackRemoved': 'Leçon supprimée.',
    'toast.courseRenamed': 'Cours renommé.',
    'toast.courseUpdated': 'Cours mis à jour.',
    'toast.courseDeleted': 'Cours supprimé.',
    'toast.nowAddFiles': 'Ajoutez maintenant les fichiers MP3 de ce cours.',
    'toast.progressReset': 'Progression réinitialisée sur cet appareil.',
    'toast.pictureFailed': 'Cette image n’a pas pu être utilisée.',
    'toast.reportSaved': 'Rapport d’écoute enregistré.',
    'toast.protectedOk': 'Les fichiers hors ligne sont protégés contre le nettoyage.',
    'toast.protectedNo': 'Le navigateur n’a pas accordé le stockage protégé. Installez l’application pour augmenter les chances.',
    'toast.repeatOff': 'Répétition désactivée.',
    'toast.repeatInf': 'Cette leçon se répétera jusqu’à ce que vous l’arrêtiez.',
    'toast.repeatTimes': 'Cette leçon sera lue {count} fois de suite.',
    'toast.breakOff': 'Aucune pause entre les répétitions.',
    'toast.breakOn': 'Pause de {seconds} secondes entre les répétitions.',
    'toast.sleepOff': 'Minuterie désactivée.',
    'toast.sleepOn': 'La lecture s’arrêtera en fondu dans {minutes} minutes.',
    'toast.sleepFired': 'Minuterie terminée — lecture arrêtée.',
    'toast.controlsReset': 'Réglages remis à leurs valeurs par défaut.',
    'toast.orientationAuto': 'L’écran suit désormais l’appareil.',
    'toast.orientationLocked': 'Écran verrouillé en {mode}.',
    'toast.orientationNeedsApp': 'Le verrouillage de l’écran ne fonctionne que dans l’application installée. Il s’appliquera une fois installée.',
    'toast.playFailed': '« {title} » n’a pas pu être lue. Supprimez-la et ajoutez le fichier à nouveau.',
    'confirm.removeTrack': 'Supprimer « {title} » de cet appareil ?',
    'confirm.resetProgress': 'Réinitialiser la progression de « {title} » sur {device} ?',
    'confirm.deleteCourse': 'Supprimer « {title} » et tout son audio de cet appareil ?',
  },
};

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

let current = 'en';

/** Picks the language to start with from the device's own preference. */
export function detectLanguage() {
  const preferred = navigator.languages || [navigator.language || 'en'];
  for (const tag of preferred) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (STRINGS[code]) return code;
  }
  return 'en';
}

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  current = STRINGS[code] ? code : 'en';
  document.documentElement.lang = current;
  return current;
}

/** Looks up a string and fills in any {placeholders}. */
export function t(key, params) {
  const table = STRINGS[current] || STRINGS.en;
  let text = table[key] ?? STRINGS.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * Applies translations to the static markup.
 *
 * `data-i18n` replaces text, `data-i18n-html` allows the few strings that carry
 * emphasis or a nested element, and the remaining attributes cover labels,
 * placeholders and titles.
 */
export function translateDocument(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  }
}
