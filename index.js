import { PassThrough, Readable } from 'stream';
import ci from 'is-ci';
import hyperquest from 'hyperquest';
import hyperdirect from 'hyperdirect';
import progress from 'progress';
import Vinyl from 'vinyl';
import color from 'ansi-colors';
import log from 'fancy-log';
import PluginError from 'plugin-error';

const hyperdirectInstance = hyperdirect(10, hyperquest);

/**
 * Canonicalizes the URLs into an object of urls and file names.
 * @param urls {string|string[]} The list of URLs to process.
 * @returns {Object[]}
 */
function canonical(urls) {
	'use strict';

	const urlArray = Array.isArray(urls) ? urls : [urls];

	return urlArray.map(url =>
		typeof url === 'object' ? url : {
			url: url,
			file: url.split('/').pop(),
		}
	);
}

/**
 * Downloads the remote file.
 * @param url {string|string[]} A URL or list of URLs to download.
 * @param options {object} Configuration object for hyperquest.
 * @returns {stream}
 */
function download(url, options) {
	'use strict';

	let firstLog = false;

	const file = new Vinyl({
		path: url.file,
		contents: new PassThrough(),
	});

	const isCI = ci || options.ci;

	const emitError = e => file.contents.emit('error', new PluginError('gulp-download2', e));

	log('Downloading', `${color.cyan(url.url)}...`);

	hyperdirectInstance(url.url, options)
		.on('response', res => {
			if (res.statusCode >= 400) {
				if (typeof options.errorCallback === 'function') {
					options.errorCallback(res.statusCode);
				} else {
					emitError(
						`${color.magenta(res.statusCode)} returned from ${color.magenta(url.url)}`
					);
				}
			}

			let bar = null;

			if (!isCI && res.headers['content-length']) {
				bar = new progress('downloading [:bar] :rate/bps :percent :etas', {
					complete: '=',
					incomplete: '-',
					width: 20,
					total: parseInt(res.headers['content-length'], 10),
				});
			} else if (!isCI) {
				const numeral = require('numeral');
				const singleLog = require('single-line-log').stdout;

				bar = require('progress-stream')({
					time: 100,
					drain: true,
				});

				bar.on('progress', prog => {
					singleLog([
						`Running: ${numeral(prog.runtime).format('00:00:00')} (${numeral(prog.transferred).format('0 b')})`,
						`${numeral(prog.speed).format('0.00b')}/s ${Math.round(prog.percentage)}%`
					].join(' '));
				});

				res.pipe(bar);
			}

			res.on('data', chunk => {
				if (firstLog) {
					process.stdout.write(
						`[${color.green('gulp')}] downloading ${color.cyan(url)}...\n`
					);

					firstLog = false;
				}

				if (!isCI && res.headers['content-length']) {
					bar.tick(chunk.length);
				}
			}).on('end', () => process.stdout.write(`\n${color.green('Done')}\n\n`));
		})
		.on('error', function (e) {
			if (typeof options.errorCallback === 'function') {
				options.errorCallback(e);
			} else {
				emitError(e);
			}
		})
		.pipe(file.contents); // write straight to disk

	return file;
}

function main(urls, options) {
	'use strict';

	const urlObjects = canonical(urls);
	options = options || {};

	let index = 0;

	return new Readable({
		objectMode: true,
		read: function (size) {
			let i = 0;
			let more = true;

			while (index < urlObjects.length && i++ < size && more) {
				more = this.push(download(urlObjects[index++], options));
			}

			if (index === urlObjects.length) {
				this.push(null);
			}
		},
	});
}

export default main;
