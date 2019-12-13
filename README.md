# filesync README

FileSync will keep files synchronized between src and dest locations.  It can also clone git repositories before synchronizing, and rename files.

***Note: This has never been run/tested on any Mac/UNIX box. My guess is it will not work, as FileSync uses the Node file System extensively, and I'm sure there are major differences in how the calls should be made.***

## Features

* Clone git repositories
* Rename files
* Keep files synchonized between source/destination directories.
* Simple to configure.

## FileSync Configuration
* Add file(s) called "fsconfig.json" (see below) to the folders you open, or are part of your workspace.

## fsconfig.json
* You can have multiple fsconfig.json files, the extension will find them in your workspace/folders and load each one.

The FileSync config file is a json object with the following layout:
```javascript
{
	"configs":
	[
		{
			"name":"sample_sync_config",
			"enabled":true,
			"rename":
			[
				{
					"src":"c:/path/to/file/file.ext",
					"name":"new_name.ext"
				}
			],
			"git":
			[
				{
					"src":"https://github.com/gitrepo/gitrepo.git",
					"dest":"c:/clone/to/this/location"
				}
			],
			"sync":
			[
				{
					"src":"c:/some/source/folder",
					"dest":"c:/some/dest/folder",
					"ignore":
					[
						"folder1/relative/to/src",
						"folder2/relative/to/src"
					],
					"bidir":true
				}
			]
		}
	]
}
```
* configs - You can have an array of config blocks, each specifying their own syncing actions.
* name - just an indentifier, has no intrinsic meaning.
* enabled - activate/ignore this block when starting.
* rename - array of objects specifying what files you want renamed before syncing (can be a single object, if just one).
  * src - the file you want to rename.
  * name - what you want the file renamed to.  You can specify '\*' as the filename to just change the extension...like "*.txt_fsync_".
* git - array of git repositories to be cloned into a specified location (can be a single object, if just one).
  * src - location of the git repository.
  * dest - where to clone the src repos into.
* sync - array of objects specifying what directories you want synchronized where (can be a single object, if just one).
  * src - the source directory to syncronize.
  * dest - the destination directory to keep synchronized.
  * ignore - array of relative paths to src to be ignored when syncing (can be a single object, if just one).
  * bidir - bidirectional synchronization...that is, files will be removed from destination if they don't exist in the source.

## Release Notes

### 1.0.0

* Initial release of FileSync

