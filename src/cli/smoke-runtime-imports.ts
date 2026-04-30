const modules = [
  "../base.js",
  "../connection.js",
  "../core/batch-capture.js",
  "../core/deploy.js",
  "../core/deployment-jobs.js",
  "../core/deployment-runner.js",
  "../core/settings.js",
  "../core/workbook.js",
  "../csv.js",
  "../processors.js",
  "../receivers.js",
  "../senders.js",
  "../utils.js",
  "../zod_types.js",
];

for (const module_path of modules) {
  await import(module_path);
  console.log(`import-ok ${module_path}`);
}

export {};
