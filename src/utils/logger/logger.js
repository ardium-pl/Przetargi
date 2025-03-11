const winston = require('winston');
const path = require('path');
const chalk = require('chalk');

const DEFAULT_LOG_LEVEL = 'debug';
const TIME_ZONE = 'Europe/Warsaw';
const DATE_FORMAT = 'en-GB';

// Wymuszenie kolorów
chalk.level = 3;

const formatDateInTimeZone = (date, timeZone) => {
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        timeZone: timeZone,
        hour12: false
    };
    return new Intl.DateTimeFormat(DATE_FORMAT, options).format(date);
};

const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: () => formatDateInTimeZone(new Date(), TIME_ZONE)
    }),
    winston.format.errors({stack: true}),
    winston.format.splat(),
    winston.format.json()
);

const getLogFilePath = (filename) => path.join(__dirname, '..', '..', 'logs', filename);

const fileTransport = (filename, level = 'debug') => new winston.transports.File({
    filename: getLogFilePath(filename),
    level,
    format: logFormat
});

// Helper do spójnego formatowania wartości
const formatValue = (value) => {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, null, 2);
        } catch (error) {
            return value.toString();
        }
    }
    return value.toString();
};

// Helper do łączenia wiadomości i argumentów
const combineMessageAndArgs = (message, args) => {
    if (args.length === 0) return formatValue(message);

    const formattedMessage = formatValue(message);
    const formattedArgs = args.map(formatValue).join(' ');

    return `${formattedMessage} ${formattedArgs}`;
};

const consoleFormat = winston.format.printf(({level, message, timestamp, label, filename, splat = []}) => {
    const colorizedLevel =
        level === 'info' ? chalk.green(level) :
            level === 'warn' ? chalk.yellow(level) :
                level === 'error' ? chalk.red(level) :
                    level === 'debug' ? chalk.blue(level) :
                        level === 'http' ? chalk.cyan(level) :
                            level === 'verbose' ? chalk.magenta(level) :
                                level === 'silly' ? chalk.grey(level) :
                                    chalk.white(level);

    const colorizedTimestamp = chalk.gray(timestamp);
    const colorizedLabel = chalk.hex('#FFA500')(label);
    const colorizedFilename = chalk.hex('#00CED1')(filename);

    return `${colorizedTimestamp} [${colorizedLevel}] [${colorizedLabel}] [${colorizedFilename}]: ${message}`;
});

const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
        winston.format.colorize(),
        consoleFormat
    )
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL,
    format: logFormat,
    transports: [
        fileTransport('combined.log'),
        fileTransport('error.log', 'error'),
        consoleTransport
    ]
});

function createLogger(filePath) {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const relativePath = path.relative(projectRoot, filePath);
    const folderStructure = path.dirname(relativePath).replace(/\\/g, '/');
    const filename = path.basename(filePath);

    const childLogger = logger.child({
        label: folderStructure,
        filename: filename
    });

    const wrapperLogger = {};
    ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].forEach(level => {
        wrapperLogger[level] = (message, ...args) => {
            const formattedMessage = combineMessageAndArgs(message, args);
            childLogger[level](formattedMessage);
        };
    });

    return wrapperLogger;
}

module.exports = {createLogger};