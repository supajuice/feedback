// Where the reviews and suggestions page sends what people write.
//
// endpoint   The Web app address of the FEEDBACK Apps Script (apps-script/Code.gs,
//            Deploy > Manage deployments). It starts with https://script.google.com/macros/s/
//            and ends with /exec. It is not the order site's address: the feedback has its own.
//            Leave it empty and the page only says thank you, sending nothing (demo mode).
window.SJ_FEEDBACK = {
  endpoint: ''
};
