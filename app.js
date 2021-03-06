var settings = require('./settings.js');
var fs = require('fs');
var flow = require('flow');
var path = require('path');
global.appRoot = path.resolve(__dirname);
var crypto = require('crypto');
var sqlite3 = require('sqlite3');
var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;
var bcrypt = require('bcrypt');
const saltRounds = 10;

// initialize database
var file = path.resolve(__dirname,'db',settings.app.db);
fs.existsSync(file);
var db = new sqlite3.Database(file);

// initialize db table for admin users
db.run("CREATE TABLE IF NOT EXISTS users ( id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, password TEXT, permissions TEXT )", function(err) {
    if(err) { throw Error(err); }
    db.get("SELECT user from users", function(err, row) {
      if(err) { throw Error(err); }
      if(!row) {
        bcrypt.hash(settings.app.defaultpass, saltRounds, function(err, hash) {
          db.run("INSERT INTO users ( user, password, permissions ) VALUES( ?, ?, 'admin' )", settings.app.defaultuser, hash, function(err) {
            if(err) { throw Error(err); }
          });
        });
      }
    });
});

// db functions
var createUser = function(req, res) {
  var user = req.body.user;
  var permissions = req.body.permissions;
  db.get('SELECT user FROM users WHERE user = ?', user, function(err, row) {
    // if(err)
    if(row) {
      req.flash('errorMessage', " there is already a user with that name");
      res.redirect(settings.page.nginxlocation + 'admin/users');
    } else {
      bcrypt.hash(req.body.password, saltRounds, function(err, hash) {
        db.run('INSERT INTO users ( user, password, permissions ) VALUES( ?, ?, ? )', user, hash, permissions, function(err) {
          // if(err)
          if(this.lastID) {
            req.flash('successMessage', " user created");
            res.redirect(settings.page.nginxlocation + 'admin/users');
          } else {
            req.flash('errorMessage', " something went wrong");
            res.redirect(settings.page.nginxlocation + 'admin/users');
          }
        });
      });
    }
  });
}

var deleteUser = function(req, res) {
  if(req.user.id == req.body.id) {
    req.flash('errorMessage', " you can't delete yourself");
    res.redirect(settings.page.nginxlocation + 'admin/users');
  } else {
    db.run('DELETE FROM users WHERE id = ?', req.body.id, function(err) {
      if(err) {
        //...
      } else {
        req.flash('successMessage', " user deleted");
        res.redirect(settings.page.nginxlocation + 'admin/users');
      }
    });
  }
}


// # hashing the password takes a second
// # need to let it complete before moving on
// # when updating a user
var updatePassword = function(req, res, cb) {
  if(req.body.password.length == 0) {
    req.flash('successMessage', " password not changed");
    cb(req, res);
  } else {
    bcrypt.hash(req.body.password, saltRounds, function(err, hash) {
      if(err) console.log(err)
      req.flash('successMessage', " password updated");
      req.query += "password = '" + hash + "', " ;
      req.runquery = true;
      cb(req, res);
    });
  }
}

var updatePermissions = function(req, res, cb) {
  if(req.user.id == req.body.id && req.body.permissions != "admin") {
    req.flash('errorMessage', " you can't remove your own admin status");
    cb(req, res);
  } else {
    req.query += "permissions = '" + req.body.permissions + "'";
    req.runquery = true;
    cb(req, res);
  }
}

var editUser = flow.define(
  function(req, res) {
    req.runquery = false;
    req.query = "UPDATE users SET ";
    updatePassword(req, res, this);
  }
  ,function(req, res) {
    updatePermissions(req, res, this);
  }
  ,function(req, res) {
    if(req.runquery == true) {
      req.query += " WHERE id = " + req.body.id;
      db.run(req.query, function(err) {
        if(err) {
          //...
          console.log(err);
          req.flash('errorMessage', " something went wrong");
          res.redirect(settings.page.nginxlocation + 'admin/users');
        } else {
          req.flash('successMessage', " user updated");
          res.redirect(settings.page.nginxlocation + 'admin/users');
        }
      });
    } else {
      req.flash('errorMessage', " something went wrong");
      res.redirect(settings.page.nginxlocation + 'admin/users');
    }
  }
);

var listUsers = function(cb) {
  db.all('SELECT id, user, permissions FROM users', function(err, rows) {
    // if(err)
    cb(rows);
  });
}

// setting up user authentication
passport.use(new LocalStrategy({ usernameField: 'user' }, function(user, password, done) {
  db.get('SELECT password FROM users WHERE user = ?', user, function(err, row) {
    if (!row) return done(null, false);
    bcrypt.compare(password, row.password, function(err, res) {
      if(!res) return done(null, false);
      db.get('SELECT user, id FROM users WHERE user = ?', user, function(err, row) {
        return done(null, row);
      });
    });
  });
}));

passport.serializeUser(function(user, done) {
  return done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  db.get('SELECT id, user, permissions FROM users WHERE id = ?', id, function(err, row) {
    if (!row) { return done(null, false); }
    return done(null, row);
  });
});

// setting up the app
var express = require('express');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var SQLiteStore = require('connect-sqlite3')(session);
var flash = require('express-flash');
var exphbs  = require('express-handlebars');
var bodyParser = require('body-parser');

var app = express();
// bodyParser to let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(cookieParser('secret'));
app.use(session({
  store: new SQLiteStore({dir:path.resolve(__dirname,'db')}),
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour
}));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

app.engine('handlebars', exphbs({
  defaultLayout: 'main',
  helpers: {
    eq: function(v1,v2,options) {
			if (v1 && v2 && v1.toString() === v2.toString()) {
				return options.fn(this);
			}
			return options.inverse(this);
		},
    returnThumb: function(filePath) {
      return filePath.slice(0, filePath.lastIndexOf(".")) +
        "_THUMB" + filePath.slice(filePath.lastIndexOf("."));
    },
    formatDate: function(context,format) {
			return moment(context).format(format);
		}
  }
}));
app.set('view engine', 'handlebars');

app.use(express.static('public'));

app.post('/login', passport.authenticate('local', {
    failureRedirect: settings.page.nginxlocation
  }), function(req, res) {
    res.redirect(settings.page.nginxlocation);
  }
);

app.post('/logout', function(req, res) {
	req.session.destroy(function(err) {
		res.redirect(settings.page.nginxlocation);
	})
});

app.get('/', function(req, res) {
		res.render('home',{
			user:req.user,
      opts:settings.page
		});
});

app.get('/admin/site', function(req, res) {
	if (req.user && req.user.permissions == "admin") {
		res.render('admin-site',{
			user:req.user,
			opts:settings.page
		});
	} else {
		res.redirect(settings.page.nginxlocation);
	}
})

app.get('/admin/users', function(req, res) {
  if(req.user && req.user.permissions == "admin") {
    listUsers(function(result) {
      res.render('admin-users',{
        user:req.user,
        users: result,
        opts:settings.page,
        error:req.flash("errorMessage"),
        success:req.flash("successMessage")
      });
    });
  } else {
    res.redirect(settings.page.nginxlocation);
  }
});

app.post('/admin/user', function(req, res) {
  if (req.user && req.user.permissions == "admin") {
    switch(req.body["_method"]) {
      case "DELETE":
        deleteUser(req, res);
      break;
      case "PUT":
        editUser(req, res);
      break;
      default:
        createUser(req, res);
      break;
    }
  } else { res.redirect(settings.app.nginxlocation); }
});

var parse = require('csv-parse');

app.get('/data/mason-training', function (req,res){
	if (req.user){
		fs.readFile(path.join(settings.app.dboxpath,settings.app.prjfolder,settings.app.trainingfolder,"Mason_Training.csv"), function(err, data) {
			if (err) throw err;
			parse(data, {columns:true}, function(error, output){
				res.send(output);
			})
		});
	}
})

app.get('/mason-training',function(req,res) {
	if (req.user) {
		res.render('mason-training', {
      user:req.user,
			opts:settings.page
    });
	} else {
		res.redirect(settings.page.nginxlocation);
	}
})

var flow = require('flow')

app.get('/data/baby-wash', function (req,res){
	if (req.user){
		var files = ["DWSS_and_WSS_Makawanpur.csv", "DWSS_and_WSS_Nuwakot.csv", "DWSS_and_WSS_Rasuwa.csv"]
		var allData = [];
		var readIt = function(filename, cb){
			fs.readFile(path.join(settings.app.dboxpath,"Baby_WASH",filename), function(err, data) {
				if (err) throw err;
				parse(data, {columns:true}, function(error, output){
					allData = allData.concat(output);
					cb();
				})
			});
		}
		flow.exec(
			function() {
				for(index in files){
					readIt(files[index], this.MULTI());
				}
			},
			function(){
				res.json(allData);
			}
		);
	}
})

app.get('/baby-wash',function(req,res) {
	if (req.user) {
		res.render('baby-wash', {
      user:req.user,
			opts:settings.page
    });
	} else {
    res.redirect(settings.page.nginxlocation);
	}
})




app.listen(settings.app.port, function() {
  console.log('app listening on port ' + settings.app.port);
});
