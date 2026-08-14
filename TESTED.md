Проверка V7

Перед упаковкой выполнены:

- синтаксическая проверка `code.js` через `node --check`;
- синтаксическая проверка встроенного JavaScript из `ui.html`;
- запуск интерфейса в Chromium без ошибок консоли;
- программная сборка тестового Smart 90+ проекта;
- проверка наличия `index.html`, `editable.html`, CSS, JS, reference WebP, отчётов и deployment-конфигов;
- тест встроенного ZIP-генератора с проверкой архива через `unzip -t`.

Тестовый результат Smart 90+:

- Visual similarity: 99.9%;
- Export readiness: 100/100;
- ZIP integrity: успешно.
