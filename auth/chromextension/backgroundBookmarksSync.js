// Initialize Firebase
var config = {
    apiKey: 'AIzaSyAC0IKj0UcvKxlGjIvzFyyKvZofLh40uYk',
    authDomain: 'browser-dev.firebaseapp.com',
    databaseURL: 'https://browser-dev.firebaseio.com',
    projectId: 'browser-dev',
    storageBucket: 'browser-dev.appspot.com',
    messagingSenderId: '516776565265'
};
firebase.initializeApp(config);

let loggedInUser;

const onCreatedCallback = function (id, bookmark) {
    doSingleBookmarksPush(loggedInUser.uid)
};
const onRemovedCallback = function (id, removeInfo) {
    doSingleBookmarksPush(loggedInUser.uid)
};

const onChangedCallback = function (id, changeInfo) {
    doSingleBookmarksPush(loggedInUser.uid)
};
const onMovedCallback = function (id, moveInfo) {
    doSingleBookmarksPush(loggedInUser.uid)
};

const onChildrenReoderedCallback = function (id, reorderInfo) {
    doSingleBookmarksPush(loggedInUser.uid)
};
const onImportEndedCallback = function () {
    doSingleBookmarksPush(loggedInUser.uid)
};

let pullOrPushInProgress = false;

function SimpleBookmark(id, parentId, url, title, isFolder) {
    this.id = id;
    this.parentId = parentId;
    this.url = url;
    this.title = title;
    this.isFolder = isFolder;
}

/**
 * initApp handles setting up the Firebase context and registering
 * callbacks for the auth status.
 *
 * The core initialization is in firebase.App - this is the glue class
 * which stores configuration. We provide an app name here to allow
 * distinguishing multiple app instances.
 *
 * This method also registers a listener with firebase.auth().onAuthStateChanged.
 * This listener is called when the user is signed in or out, and that
 * is where we update the UI.
 *
 * When signed in, we also authenticate to the Firebase Realtime Database.
 */
function initApp() {
    firebase.auth().onAuthStateChanged(function (user) {
        if (user) {
            loggedInUser = user;
            startBookmarksSync(user.uid);
        } else {
            loggedInUser = null;
            stopBookmarksSync()
        }
    });
}

function startBookmarksSync(uid) {

    chrome.bookmarks.onCreated.addListener(onCreatedCallback);
    chrome.bookmarks.onRemoved.addListener(onRemovedCallback);
    chrome.bookmarks.onChanged.addListener(onChangedCallback);
    chrome.bookmarks.onMoved.addListener(onMovedCallback);
    chrome.bookmarks.onChildrenReordered.addListener(onChildrenReoderedCallback);
    chrome.bookmarks.onImportEnded.addListener(onImportEndedCallback);

    doSingleBookmarksPush(uid, function (error) {
        console.log("bookmarks_sync", "bookmarks_push_success");

        doSingleBookmarksPull(uid, function () {
            console.log("bookmarks_sync", "bookmarks_pull_success");

        });

    });

}

function getBookmarksFirebasePath(uid) {
    let root = firebase.database();
    return root.ref(uid + "/chrome_bookmarks");
}

function doSingleBookmarksPush(uid, callback) {
    if (pullOrPushInProgress)
        return;
    pullOrPushInProgress = true;
    chrome.bookmarks.getTree(function (results) {

        const simpleBookmarks = [];
        readSubTree(results, simpleBookmarks);

        let bookmarks = getBookmarksFirebasePath(uid);
        bookmarks.set(simpleBookmarks, function () {
            pullOrPushInProgress = false;
            callback()
        });
    });
}

function readSubTree(subTree, simpleBookmarks) {
    const length = subTree.length;
    for (let i = 0; i < length; i++) {
        const node = subTree[i];
        const id = parseInt(node.id);
        const parentId = parseInt('parentId' in node ? node.parentId : -1);
        const url = 'url' in node ? node.url : "";
        const title = node.title;
        const isFolder = ('children' in node && url === "");
        const simpleBookmark = new SimpleBookmark(id, parentId, url, title, isFolder);
        simpleBookmarks.push(simpleBookmark);

        if (isFolder) {
            //is a folder
            readSubTree(node.children, simpleBookmarks)
        }
    }
}

function stopBookmarksSync() {
    chrome.bookmarks.onCreated.removeListener(onCreatedCallback);
    chrome.bookmarks.onRemoved.removeListener(onRemovedCallback);
    chrome.bookmarks.onChanged.removeListener(onChangedCallback);
    chrome.bookmarks.onMoved.removeListener(onMovedCallback);
    chrome.bookmarks.onChildrenReordered.removeListener(onChildrenReoderedCallback);
    chrome.bookmarks.onImportEnded.removeListener(onImportEndedCallback);
}

window.onload = function () {
    initApp();
};


function doSingleBookmarksPull(uid, callback) {
    let bookmarks = getBookmarksFirebasePath(uid);
    bookmarks.on('value', function (dataSnapshot) {

        if (pullOrPushInProgress)
            return;
        pullOrPushInProgress = true;

        let folders = new Map();
        let index = 0;
        let simpleBookmarks = dataSnapshot.val();

        if (simpleBookmarks.length > 0) {
            let recursionCallback = function () {
                index++;
                if (index === simpleBookmarks.length) {
                    pullOrPushInProgress = false;
                    callback()
                } else {
                    createSingleBookmark(folders, simpleBookmarks[index], recursionCallback)
                }
            };

            clearTopLevelFolders(function () {
                createSingleBookmark(folders, simpleBookmarks[index], recursionCallback);
            });
        } else {
            pullOrPushInProgress = false;
            callback()
        }
    });
}

function clearTopLevelFolders(callback) {
    chrome.bookmarks.getTree(function (results) {
        const topLevelNodes = results[0].children;
        let itemsToDelete = 0;
        for (let topLevelIndex = 0; topLevelIndex < topLevelNodes.length; topLevelIndex++) {
            const topLevelNode = topLevelNodes[topLevelIndex];
            const children = topLevelNode.children;
            itemsToDelete += children.length;
            if (topLevelIndex === topLevelNodes.length - 1 && itemsToDelete === 0) {
                callback()
            } else {
                for (let childIndex = 0; childIndex < children.length; childIndex++) {
                    const child = children[childIndex];
                    chrome.bookmarks.removeTree(child.id, function () {
                        itemsToDelete--;
                        if (itemsToDelete === 0) {
                            callback()
                        }
                    });
                }
            }
        }
    })
}

function createSingleBookmark(folders, simpleBookmark, callback) {
    let id = simpleBookmark.id;
    let isFolder = simpleBookmark.isFolder;
    let title = simpleBookmark.title;
    let url = simpleBookmark.url;
    let parentId = simpleBookmark.parentId;

    if (id === 0 || parentId === 0) {
        //ignoring top level folders
        callback();
        return;
    }

    let parent = folders.get(parentId);
    if (!parent) {
        switch (parentId) {
            case 1:
                parent = "1";
                break;
            case 2:
                parent = "2";
                break;
            default:
                parent = "3";
                break;
        }
    }
    let bookmark = {parentId: parent, title: title, url: url};
    chrome.bookmarks.create(bookmark, function (result) {
            if (isFolder) {
                folders.set(id, result.id);
            }
            callback()
        }
    )
}
