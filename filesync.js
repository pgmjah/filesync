#!/usr/bin/env node
//copyright (c) 2019 pgmjah. All rights reserved.

const EventEmitter = require("events");
const cproc = require("child_process");
const paths = require("path");
const util = require("util");
const fs = require("fs");

class fileSync extends EventEmitter
{
	constructor(config)
	{
		super();
		this._config = Object.assign({}, config);
	}
	start()
	{
		let config = this._config;
		config.fs = this;

		//rename the desired files.
		if(config.rename)
		{
			let renames = (config.rename instanceof Array) ? config.rename : [config.rename];
			renames.map((oRename)=>
			{
				if(fileSync.itemExists(oRename.src))
				{
					let srcPath = paths.parse(paths.resolve(config.cfgFilePath, oRename.src));
					let destPath = paths.parse(paths.resolve(config.cfgFilePath, oRename.name));
					let destName = destPath.name === "*" ? srcPath.name : destPath.name;
					let name = `${srcPath.dir}/${destName}${destPath.ext || srcPath.ext}`;
					this.renameItem(oRename.src, name);
					this.emit("fsync_log", "filesync", "rename", {"src":oRename.src, "name": name});
				}
			});
		}

		if(config.git)
		{
			var promises = [];
			let gits = (config.git instanceof Array) ? config.git : [config.git];
			gits.map((git)=>
			{
				promises.push(new Promise((resolve, reject)=>
				{
					this.emit("fsync_log", "git", "clone", {"git":git});
					let clone = cproc.exec(`git clone --progress ${git.src} ${paths.resolve(config.cfgFilePath, git.dest)}`, {}, (error, stdout, stderr)=>
					{
						resolve(git);
					});
					clone.stderr.on('data', (data)=>
					{
						data = data.replace(/\n/ig, "");
						this.emit("fsync_log", "git", "clone", {"git":git, "data":data});
					});
					clone.stdout.on('data', (data)=>
					{
						this.emit("fsync_log", "git", "clone", {"git":git, "data":data});
					});
				}));
			});

			let promiseAll = Promise.all(promises).then((data)=>
			{
				this.startSyncs(config.sync);
			});
			return promiseAll;
		}
		else
		{
			//start the syncs.
			this.startSyncs(config.sync);
			return Promise.resolve(config);
		}		
	}
	startSyncs(syncs)
	{
		syncs = syncs || this._config.sync;
		syncs = (syncs instanceof Array) ? syncs : [syncs];
		syncs.map((sync)=>
		{
			if(sync._fsWatch)
				return;
			
			let config = this._config;
			sync.src = paths.resolve(config.cfgFilePath, sync.src);
			sync.dest = paths.resolve(config.cfgFilePath, sync.dest);

			this.syncItem("", sync); //initial sync...will make sure the dest is there and up to date.
			try
			{
				sync._fsWatch = fs.watch(sync.src, {recursive:true})
				sync._fsWatch.on("change", (type, filename)=>
				{
					this.syncItem(filename, sync);
				});
				sync._fsWatch.on("close", ()=>
				{
					this.emit("fsync_log", "filesync", "sync_closed", sync.src);
					delete sync._fsWatch;
				});
				this.emit("fsync_log", "filesync", "sync_watching", sync);
				sync.active = true;
			}
			catch(ex)
			{
				this.emit("fsync_log", "filesync", "not watching", ex.message);
			}
		});
	}
	stopSyncs(syncs)
	{
		syncs = syncs || this._config.sync;
		syncs = (syncs instanceof Array) ? syncs : [syncs];
		for(let key in syncs)
		{
			let sync = syncs[key];
			if(!sync._fsWatch)
				continue;
			sync._fsWatch.close();
			delete sync.active;
		}
	}
	createFolder(path)
	{
		let dirs = path.replace(/\\/g, "/").split("/").reverse();
		let dir = "";

		while(dirs.length)
		{
			dir += `${dirs.pop()}/`;
			if(!fileSync.itemExists(dir))
			{
				fs.mkdirSync(dir);
				this.emit("fsync_log", "dir", "create", {"src":dir});
			}
		}
	}
	syncItem(itemPath, sync)
	{
		//if ignored, just continue along our merry way!
		let ignore = [].concat((sync.ignore instanceof Array) ? sync.ignore : [sync.ignore]);
		if((-1 != itemPath.search(".git")) || (-1 != ignore.indexOf(itemPath)))
			return;

		itemPath = itemPath.replace(/\\/g, "/");
		let srcPath = `${sync.src}/${itemPath}`;
		let destPath = `${sync.dest}/${itemPath}`;
		let srcStat = fileSync.itemExists(srcPath);
		let destStat = fileSync.itemExists(destPath);

		//delete file if source doesn't exit anymore.
		if(!srcStat)
		{
			this.deleteItem(destPath);
			return;
		}

		//copy/recurse items.
		if(srcStat.isDirectory(srcPath))
		{
			//folder doesn't exist, create it
			if(!destStat)
				this.createFolder(destPath);

			//recurse folders and sync
			fs.readdirSync(srcPath).forEach((file, index)=>
			{
				this.syncItem(`${itemPath}${itemPath ? "/" : ""}${file}`, sync);//pass relative path...outer will concat with srcPath
			});

			//clean out files in dest that aren't in src.
			if(sync.bidir)
			{
				fs.readdirSync(destPath).forEach((file, index)=>
				{
					//use full paths...not recursing, just nuking!
					if(!fileSync.itemExists(`${srcPath}/${file}`))
						this.deleteItem(`${destPath}/${file}`);
				});
			}
		}
		else
		{
			if(!destStat || (srcStat.mtimeMs > destStat.mtimeMs))
			{
				//big files can be locked while being copied/moved...so try a bunch of times to copy it...if fails, then just bail.
				let nTimes = 0;
				while(true)
				{
					try
					{
						let fd = fs.openSync(srcPath, "r+");
						fs.closeSync(fd);
						fs.copyFileSync(srcPath, destPath);
						this.emit("fsync_log", "file", "copy", {"src":srcPath, "dest":destPath});
						break;
					}
					catch(ex)
					{
						if(++nTimes > 5000)
						{
							this.emit("fsync_log", "file", "copy", {"src":srcPath, "dest":destPath, "exception":ex});
							break;
						}
					}
				}
			}
		}
	}
	deleteItem(path)
	{
		if(fileSync.itemExists(path))
		{
			let lstat = fs.lstatSync(path);
			if(lstat.isDirectory())
			{
				fs.readdirSync(path).forEach((file, index) =>
				{
					let curPath = path + "/" + file;
					this.deleteItem(curPath);
				});

				try
				{
					fs.rmdirSync(path);
					this.emit("fsync_log", "dir", "delete", {"src":path});
				}
				catch(ex)
				{
					if(ex.code == "ENOTEMPTY")
						this.deleteItem(path);
				}
			}
			else
			{
				fs.unlinkSync(path);
				this.emit("fsync_log", "file", "delete", {"src":path});
			}

		}
	}
	renameItem(oldPath, newPath)
	{
		fs.renameSync(oldPath, newPath);
	}
	static itemExists(path)
	{
		let ret = true;
		try
		{
			ret = fs.statSync(path);
		}
		catch(ex)
		{
			ret = false;
		}
		return ret;
	}

	static fmtLogMessage(type, action, data)
	{
		let msg = `${type} ${action} ${data ? JSON.stringify(data) : ""}`;
		let date = new Date();
		date = `${fileSync._fmtDateVal(date.getFullYear())}-${fileSync._fmtDateVal(date.getMonth()+1)}-${fileSync._fmtDateVal(date.getDate())} ${fileSync._fmtDateVal(date.getHours())}:${fileSync._fmtDateVal(date.getMinutes())}:${fileSync._fmtDateVal(date.getSeconds())}`;
		return {"msg":msg, "date":date, "type":type, "action":action, "data":data};
	}
	static fmtPath(strPath)
	{
		let path = paths.parse(strPath);
		let dir = path.dir.split("/");
		let dirPrefix = dir.length > 6 ? dir.slice(0, 4).join("/") : null;
		let dirSuffix = dir.length > 6 ? dir.slice(dir.length - 3).join("/") : null;
		return (dirPrefix && dirSuffix) ? `${dirPrefix}/.../${dirSuffix}/${path.name}${path.ext}` : `${path.dir}/${path.name}${path.ext}`;
	}
	static _fmtDateVal(dateVal)
	{
		return (dateVal < 10) ? `0${dateVal}` : dateVal;
	}
	static log(type, action, data)
	{
		//not running standalone.
		if(module.parent)
			return;
		let log = fileSync.fmtLogMessage(type, action, data);
		console.log(`[${log.date}] ${log.msg}`);
	}
	static processConfigFile(filePath)
	{
		var fileSyncs = {};
		async function startFileSyncs(configs, idx, configFile)
		{
			let config = configs[idx];
			if(config && config.enabled)
			{
				config.cfgFilePath = paths.parse(configFile.filePath).dir;
				let fsync = new fileSync(config);
				fsync.on("fsync_log", fileSync.log);
				await fsync.start();
				fileSyncs[config.name] = fsync;
			}
			(configs.length > ++idx) ? startFileSyncs.call(this, configs, idx, configFile) : 5;
		}

		try
		{
			let configFile = fs.readFileSync(filePath);
			configFile = JSON.parse(configFile);
			configFile.filePath = filePath;
			startFileSyncs(configFile.configs, 0, configFile);
		}
		catch(ex)
		{
			fileSync.log("initialize", "load config", ex);
			fileSync.log("INFO", "if no config.json file, make one with the 'mkdef' command.");
		}
		return fileSyncs;
	}
}

//running standalone so read config file
var arg1 = process.argv[1];
if(arg1 && arg1.search("filesync.js") != -1)
{
	fileSync.processConfigFile(process.argv.slice(2)[0] || "fsconfig.json");

	process.stdin.setEncoding("utf8");
	process.stdin.on('readable', function()
	{
		let chunk;
		while ((chunk = process.stdin.read()) !== null)
		{
			chunk = chunk.replace(/[\n\r]*/g, "");
			if(chunk == "cls")
				console.clear();
			else
			if(chunk == "mkdef")
			{
				info = paths.parse(module.filename);
				fs.copyFile(`${info.dir}\\fsconfig_default.json`, `${process.cwd()}\\fsconfig.json`, fs.constants.COPYFILE_EXCL, function(err)
				{
					if(err)
						console.log(err);
					else
					{
						console.log("Default fsconfig.json file created.");
						process.exit();
					}
				});
			}
			else
			if(chunk == "quit" || chunk == "exit")
			{
				process.exit(1);
			}			
		}
	});
}

module.exports = 
{
	"fileSync":fileSync,
}